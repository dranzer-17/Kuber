import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { complete } from "@/lib/services/llm";
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

async function processOneOrg(
  db: Db,
  org: { id: string; domain: string | null; name: string },
) {
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

  // ── B: Validate domain ─────────────────────────────────────────────────────
  if (!org.domain) {
    await markFailed(db, org.id, "SCRAPE_FAILED", "No domain available after Phase 2A");
    return;
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
      system: `You are extracting company profile data for a B2B sales team at Kuber Polyplast, a masterbatch and specialty plastics manufacturer.
From the website content below, extract only:
1. company_description: 2-3 sentences on what this company does and manufactures
2. sells_to: who their end customers or industries are (e.g. "packaging manufacturers, automotive OEMs, FMCG brands")

Return ONLY a valid JSON object with no markdown, no preamble, no explanation:
{ "company_description": "...", "sells_to": "..." }
If you cannot determine a field, return null for that field.`,
      user: markdown.slice(0, 8000),
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
  if (req.headers.get("x-internal-secret") !== process.env.INTERNAL_SECRET) {
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
      await processOneOrg(db, org);
      // Check if it completed (vs failed inside processOneOrg)
      const { data: updated } = await db
        .from("organizations")
        .select("enrichment_stage")
        .eq("id", org.id)
        .single();
      if (updated?.enrichment_stage === "done") succeeded++;
      else failed++;
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
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    fetch(`${baseUrl}/api/enrich/scrape-orgs`, {
      method: "POST",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET! },
    }).catch(() => {});
  }

  return Response.json({ processed, succeeded, failed });
}
