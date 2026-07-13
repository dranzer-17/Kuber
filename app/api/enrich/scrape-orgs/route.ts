import { NextRequest, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { complete } from "@/lib/services/llm";
import { internalAppBaseUrl } from "@/lib/internal-url";
import { deriveDomainFromEmail } from "@/lib/utils/domain";
import { autoAssignEnrichedLeads } from "@/lib/services/assignment";
import { safeSecretEqual } from "@/lib/auth/secret";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 55;

// ── Helpers ───────────────────────────────────────────────────────────────────

type Db = SupabaseClient;

async function insertLog(db: Db, entry: {
  org_id?: string;
  lead_id?: string;
  event: string;
  source: string;
  stage?: string;
  payload?: Record<string, unknown>;
  duration_ms?: number;
  error?: string;
}) {
  await db.from("enrichment_logs").insert({
    org_id: entry.org_id ?? null,
    lead_id: entry.lead_id ?? null,
    event: entry.event,
    source: entry.source,
    stage: entry.stage ?? null,
    payload: entry.payload ?? null,
    duration_ms: entry.duration_ms ?? null,
    error: entry.error ? entry.error.slice(0, 500) : null, // strip long stack traces
    created_at: new Date().toISOString(),
  });
}

async function markFailed(db: Db, orgId: string, status: string, errorMessage: string) {
  const { data: org } = await db
    .from("organizations")
    .select("enrichment_attempts")
    .eq("id", orgId)
    .single();

  const attempts = (org?.enrichment_attempts ?? 0) + 1;
  const isPermanent = attempts >= 3;

  await db.from("organizations").update({
    enrichment_stage: isPermanent ? "failed" : "failed",
    enrichment_status: isPermanent ? "ENRICHMENT_FAILED_PERMANENT" : status,
    enrichment_attempts: attempts,
    last_error: errorMessage.slice(0, 500),
    updated_at: new Date().toISOString(),
  }).eq("id", orgId);

  // Fix A: sync leads.status when org enrichment fails
  await db.from("leads")
    .update({ status: "input_required", updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("is_deleted", false)
    .not("status", "in", '("open","closed")');

  await insertLog(db, {
    org_id: orgId,
    source: "system",
    event: isPermanent ? "ENRICHMENT_FAILED_PERMANENT" : "ENRICHMENT_FAILED",
    error: errorMessage,
    payload: { attempts, is_permanent: isPermanent },
  });
}

// Falls back to the org's leads' email domains when Apollo never resolved one.
// Free/webmail providers (gmail.com etc.) are ignored. Requires a clear
// majority among candidate domains; ties or no candidates return null.
// Reassigns a duplicate org's leads onto the org that already owns their real
// domain, then deletes the now-empty duplicate. Leads inherit "enriched" if
// the target org is already done, otherwise they wait on the target's own turn.
async function mergeDuplicateOrg(db: Db, dupOrgId: string, targetOrgId: string, domain: string) {
  const { data: targetOrg } = await db
    .from("organizations")
    .select("enrichment_stage")
    .eq("id", targetOrgId)
    .single();

  const mergedLeadStatus = targetOrg?.enrichment_stage === "done" ? "enriched" : "input_required";

  await db.from("leads")
    .update({ organization_id: targetOrgId, status: mergedLeadStatus, updated_at: new Date().toISOString() })
    .eq("organization_id", dupOrgId)
    .eq("is_deleted", false);

  await insertLog(db, {
    org_id: dupOrgId,
    source: "email_fallback",
    event: "ORG_MERGED_DUPLICATE_DOMAIN",
    payload: { merged_into: targetOrgId, domain },
  });

  await db.from("organizations").delete().eq("id", dupOrgId);
}

type DomainInferenceResult =
  | { type: "resolved"; domain: string }
  | { type: "duplicate"; targetOrgId: string; domain: string }
  | { type: "failed" };

async function inferDomainFromLeadEmails(db: Db, orgId: string): Promise<DomainInferenceResult> {
  const { data: leads } = await db
    .from("leads")
    .select("email")
    .eq("organization_id", orgId)
    .eq("is_deleted", false)
    .not("email", "is", null);

  const counts = new Map<string, number>();
  for (const lead of leads ?? []) {
    const domain = lead.email ? deriveDomainFromEmail(lead.email) : null;
    if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  if (counts.size === 0) {
    await insertLog(db, {
      org_id: orgId,
      source: "email_fallback",
      event: "DOMAIN_INFERENCE_FAILED",
      payload: { lead_count: leads?.length ?? 0, reason: "no_valid_candidates" },
    });
    return { type: "failed" };
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [topDomain, topCount] = sorted[0];
  const isTie = sorted.length > 1 && sorted[1][1] === topCount;

  if (isTie) {
    await insertLog(db, {
      org_id: orgId,
      source: "email_fallback",
      event: "DOMAIN_INFERENCE_FAILED",
      payload: { lead_count: leads?.length ?? 0, candidates: sorted, candidate_conflict: true },
    });
    return { type: "failed" };
  }

  // Another org record may already own this domain (a duplicate company record,
  // e.g. two Apollo/Excel entries for the same real company). Reuse it instead
  // of failing — this is what actually resolves the common case.
  const { data: existingOrg } = await db
    .from("organizations")
    .select("id")
    .eq("domain", topDomain)
    .neq("id", orgId)
    .maybeSingle();

  if (existingOrg) {
    return { type: "duplicate", targetOrgId: existingOrg.id, domain: topDomain };
  }

  const { error } = await db.from("organizations")
    .update({ domain: topDomain, domain_source: "email_inferred", updated_at: new Date().toISOString() })
    .eq("id", orgId)
    .is("domain", null);
  if (error) {
    // Race: another org claimed this domain between our check and our write.
    await insertLog(db, {
      org_id: orgId,
      source: "email_fallback",
      event: "DOMAIN_INFERENCE_CONFLICT",
      error: error.message,
      payload: { derived_domain: topDomain, lead_count: leads?.length ?? 0 },
    });
    return { type: "failed" };
  }

  await insertLog(db, {
    org_id: orgId,
    source: "email_fallback",
    event: "DOMAIN_INFERRED_FROM_EMAIL",
    payload: { derived_domain: topDomain, candidate_count: counts.size, lead_count: leads?.length ?? 0 },
  });

  return { type: "resolved", domain: topDomain };
}

async function processOneOrg(
  db: Db,
  org: { id: string; domain: string | null; name: string },
): Promise<"merged" | void> {
  const orgStart = Date.now();

  // ── A: Mark SCRAPE_STARTED ─────────────────────────────────────────────────
  await db.from("organizations").update({
    enrichment_status: "SCRAPE_STARTED",
    updated_at: new Date().toISOString(),
  }).eq("id", org.id);

  await insertLog(db, {
    org_id: org.id,
    source: "system",
    event: "SCRAPE_STARTED",
    payload: { domain: org.domain, org_name: org.name },
  });

  // ── B: Validate domain, falling back to leads' email domains ────────────────
  if (!org.domain) {
    const result = await inferDomainFromLeadEmails(db, org.id);
    if (result.type === "duplicate") {
      await mergeDuplicateOrg(db, org.id, result.targetOrgId, result.domain);
      return "merged";
    }
    if (result.type === "failed") {
      await markFailed(db, org.id, "SCRAPE_FAILED", "No domain available after Phase 2A and no usable lead email domain");
      return;
    }
    org.domain = result.domain;
  }

  // ── C: Firecrawl scrape ────────────────────────────────────────────────────
  const scrapeStart = Date.now();
  let markdown: string | null = null;

  try {
    const firecrawlRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url: `https://${org.domain}`,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 15000,
      }),
    });

    const firecrawlData = await firecrawlRes.json() as {
      success?: boolean;
      error?: string;
      data?: { markdown?: string };
    };
    const scrapeDuration = Date.now() - scrapeStart;

    if (!firecrawlRes.ok || !firecrawlData.success) {
      const errMsg = firecrawlData.error ?? `HTTP ${firecrawlRes.status}`;
      await insertLog(db, {
        org_id: org.id,
        source: "firecrawl",
        event: "SCRAPE_FAILED",
        duration_ms: scrapeDuration,
        error: errMsg,
        payload: { status: firecrawlRes.status, domain: org.domain },
      });
      await markFailed(db, org.id, "SCRAPE_FAILED", errMsg);
      return;
    }

    markdown = firecrawlData.data?.markdown ?? null;
    const charCount = markdown?.length ?? 0;

    if (!markdown || charCount < 500) {
      await insertLog(db, {
        org_id: org.id,
        source: "firecrawl",
        event: "SCRAPE_EMPTY",
        duration_ms: scrapeDuration,
        payload: { chars: charCount, domain: org.domain },
      });
      await markFailed(db, org.id, "SCRAPE_EMPTY", "Firecrawl returned empty or insufficient content");
      return;
    }

    await insertLog(db, {
      org_id: org.id,
      source: "firecrawl",
      event: "SCRAPE_SUCCESS",
      duration_ms: scrapeDuration,
      payload: { chars: charCount, domain: org.domain },
    });

    await db.from("organizations").update({
      enrichment_status: "SCRAPE_SUCCESS",
      updated_at: new Date().toISOString(),
    }).eq("id", org.id);

  } catch (err) {
    const errMsg = (err as Error).message;
    await insertLog(db, {
      org_id: org.id,
      source: "firecrawl",
      event: "SCRAPE_FAILED",
      duration_ms: Date.now() - scrapeStart,
      error: errMsg,
      payload: { domain: org.domain },
    });
    await markFailed(db, org.id, "SCRAPE_FAILED", errMsg);
    return;
  }

  // ── D: LLM extraction via OpenRouter ─────────────────────────────────────
  const llmStart = Date.now();

  await db.from("organizations").update({
    enrichment_status: "LLM_EXTRACTION_STARTED",
    updated_at: new Date().toISOString(),
  }).eq("id", org.id);

  await insertLog(db, {
    org_id: org.id,
    source: "llm",
    event: "LLM_EXTRACTION_STARTED",
    payload: { model: process.env.LLM_PRIMARY_MODEL ?? "openai/gpt-4o-mini", input_chars: markdown.length },
  });

  try {
    const { json: extracted } = await complete<{ company_description: string | null; sells_to: string | null }>({
      system: `You are a company profile extractor. From the website content provided, extract facts about THIS specific company only.

Return ONLY valid JSON with no markdown, no preamble:
{ "company_description": string | null, "sells_to": string | null }

Rules:
- company_description: 2-3 sentences describing what THIS company manufactures, produces, or does, and what industry it operates in.
- sells_to: who their end customers or industries are in plain terms (e.g. "automotive OEMs", "food packaging brands", "retail chains"). Return null if unclear.
- If you cannot find real evidence for a field in the provided content, return null for that field. Never invent facts. Never describe yourself or any third party — only describe the company whose website you are reading.`,
      user: `Company name: ${org.name}\nWebsite domain: ${org.domain ?? "unknown"}\n\nWebsite content:\n${markdown.slice(0, 8000)}`,
    });

    const llmDuration = Date.now() - llmStart;
    const hasDescription = !!extracted?.company_description;
    const hasSellsTo = !!extracted?.sells_to;
    const extractionEvent = hasDescription && hasSellsTo
      ? "LLM_EXTRACTION_SUCCESS"
      : "LLM_EXTRACTION_PARTIAL";

    await insertLog(db, {
      org_id: org.id,
      source: "llm",
      event: extractionEvent,
      duration_ms: llmDuration,
      payload: { has_description: hasDescription, has_sells_to: hasSellsTo },
    });

    // ── E: Write results + mark complete ──────────────────────────────────────
    const totalDuration = Date.now() - orgStart;

    // Fix E: LLM returned no usable data — treat as soft failure, not success
    const hasExtractedData = !!(extracted?.company_description);
    if (!hasExtractedData) {
      await markFailed(db, org.id, "LLM_EXTRACTION_PARTIAL_NO_DATA",
        "LLM returned no description or data for this org. Will retry.");
      return;  // exit processOneOrg early — do not mark as done
    }

    // Only reach here if we have real data
    await db.from("organizations").update({
      company_description: extracted.company_description,
      sells_to: extracted?.sells_to ?? null,
      has_scraped: true,
      enrichment_stage: "done",
      enrichment_status: "ENRICHMENT_COMPLETE",
      enrichment_done_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", org.id);

    // Fix A: sync leads.status → enriched for all non-terminal leads under this org
    await db.from("leads")
      .update({ status: "enriched", updated_at: new Date().toISOString() })
      .eq("organization_id", org.id)
      .eq("is_deleted", false)
      .not("status", "in", '("open","closed")');

    // Only enriched leads are eligible for employee assignment.
    await autoAssignEnrichedLeads(db, org.id);

    await insertLog(db, {
      org_id: org.id,
      source: "system",
      event: "ENRICHMENT_COMPLETE",
      duration_ms: totalDuration,
      payload: { total_duration_ms: totalDuration },
    });

  } catch (err) {
    const errMsg = (err as Error).message;
    await insertLog(db, {
      org_id: org.id,
      source: "llm",
      event: "LLM_EXTRACTION_FAILED",
      duration_ms: Date.now() - llmStart,
      error: errMsg,
    });
    await markFailed(db, org.id, "LLM_EXTRACTION_FAILED", errMsg);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!safeSecretEqual(req.headers.get("x-internal-secret"), process.env.INTERNAL_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();

  // ── Watchdog: reset orgs stuck in 'scraping' beyond the function's max lifetime
  await db.from("organizations")
    .update({
      enrichment_stage: "queued",
      enrichment_status: "REQUEUED_STUCK_SCRAPING",
      has_scraped: false,
      updated_at: new Date().toISOString(),
    })
    .eq("enrichment_stage", "scraping")
    .lt("enrichment_started_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  // ── Step 1: Fetch one batch of 10 queued orgs ──────────────────────────────
  const { data: orgs } = await db
    .from("organizations")
    .select("id, domain, name")
    .eq("enrichment_stage", "queued")
    .order("created_at", { ascending: true })
    .limit(10);

  if (!orgs || orgs.length === 0) {
    await insertLog(db, {
      source: "system",
      event: "BATCH_COMPLETE",
      payload: { reason: "no_more_queued_orgs" },
    });
    return Response.json({ processed: 0, succeeded: 0, failed: 0, status: "no_more_queued" });
  }

  // ── Step 2: Log batch start + mark as scraping ─────────────────────────────
  await insertLog(db, {
    source: "system",
    event: "SCRAPE_BATCH_STARTED",
    payload: { batch_size: orgs.length, org_ids: orgs.map((o) => o.id) },
  });

  const orgIds = orgs.map((o) => o.id);
  await db.from("organizations").update({
    enrichment_stage: "scraping",
    enrichment_status: "SCRAPE_BATCH_STARTED",
    enrichment_started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).in("id", orgIds);

  // ── Step 3: Process each org sequentially ─────────────────────────────────
  for (const org of orgs) {
    processed++;
    const beforeStage = "queued";
    try {
      const outcome = await processOneOrg(db, org);
      if (outcome === "merged") {
        succeeded++;
      } else {
        // Check if it completed (vs failed inside processOneOrg)
        const { data: updated } = await db
          .from("organizations")
          .select("enrichment_stage")
          .eq("id", org.id)
          .single();
        if (updated?.enrichment_stage === "done") succeeded++;
        else failed++;
      }
    } catch {
      failed++;
      await markFailed(db, org.id, "SCRAPE_FAILED", "Unexpected error in processOneOrg").catch(() => {});
    }
    void beforeStage; // suppress unused warning
  }

  // ── Step 4: Self-trigger if more queued orgs remain ───────────────────────
  const { count } = await db
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .eq("enrichment_stage", "queued");

  if ((count ?? 0) > 0) {
    const baseUrl = internalAppBaseUrl(req);
    const secret = process.env.INTERNAL_SECRET!;
    after(() =>
      fetch(`${baseUrl}/api/enrich/scrape-orgs`, {
        method: "POST",
        headers: { "x-internal-secret": secret },
      }).catch(() => {})
    );
  }

  return Response.json({ processed, succeeded, failed });
}
