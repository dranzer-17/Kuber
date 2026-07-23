import { NextRequest, after } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { EnrichSchema } from "@/lib/validators/leads";
import { enrichLeads, type EnrichTarget } from "@/lib/services/enrich-leads";
import { internalAppBaseUrl } from "@/lib/internal-url";
import { getServiceSecret } from "@/lib/services/service-keys";

export const maxDuration = 300;

// Each matched lead does several sequential DB writes (org lookup/upsert, lead
// update, campaign_leads update) on top of the bulk_match call itself, so a
// large `import_id` batch (a big Apollo search can create 1000+ leads in one
// request) can run past the 300s function cap and get killed mid-loop —
// before it ever reaches the code that triggers org scraping below. 150 stays
// comfortably inside the time budget; the self-trigger at the end picks up
// whatever's left for the same import.
const ENRICH_BATCH_SIZE = 150;

export async function POST(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = EnrichSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  // DB-first key resolution (Settings > Keys), matching bulkMatch()'s own path
  // — an env-only check 503s the whole email-reveal pass in production.
  if (!(await getServiceSecret("apollo"))) {
    return fail(503, "UPSTREAM_APOLLO", "Apollo API key not configured — add one in Settings > Keys");
  }

  const db = createAdminClient();

  let q = db
    .from("leads")
    .select("id, apollo_id, first_name, last_name, title, country, city, state, organization_id, organizations(name)")
    .eq("lead_source", "apollo")
    .eq("has_email", true)
    .is("email", null);

  if ("campaign_id" in parsed.data) {
    const { data: memberIds } = await db
      .from("campaign_leads").select("lead_id").eq("campaign_id", parsed.data.campaign_id);
    const ids = (memberIds ?? []).map((r) => r.lead_id);
    if (ids.length === 0) return ok({ requested: 0, matched: 0, archived: 0, missing_apollo_ids: [], credits_consumed: 0, verified: 0, unverified: 0, remaining: 0 });
    q = q.in("id", ids).limit(parsed.data.limit);
  } else if ("import_id" in parsed.data) {
    q = q.eq("import_id", parsed.data.import_id).limit(ENRICH_BATCH_SIZE);
  } else {
    q = q.in("id", parsed.data.lead_ids);
  }

  const { data: rows, error } = await q;
  if (error) return fail(500, "INTERNAL", error.message);
  if (!rows?.length) return ok({ requested: 0, matched: 0, archived: 0, missing_apollo_ids: [], credits_consumed: 0, verified: 0, unverified: 0, remaining: 0 });

  // Atomically claim this candidate set before spending any Apollo credits on
  // it — without this, the natural self-chain and a watchdog nudge (or two
  // watchdog nudges) firing close together can both select the same pending
  // leads and both pay Apollo to look up the same people. FOR UPDATE SKIP
  // LOCKED (inside the RPC) means only one caller ever actually gets a given
  // lead back; the other silently gets a smaller set instead of a duplicate.
  const { data: claimed, error: claimError } = await db.rpc("claim_unenriched_leads", {
    p_ids: rows.map((r) => r.id),
  });
  if (claimError) return fail(500, "INTERNAL", claimError.message);

  const claimedIds = new Set((claimed as Array<{ id: string }> ?? []).map((r) => r.id));
  const targets: EnrichTarget[] = rows
    .filter((t) => claimedIds.has(t.id))
    .map((t) => {
      const org = Array.isArray(t.organizations) ? t.organizations[0] : t.organizations;
      return {
        id: t.id, apollo_id: t.apollo_id, first_name: t.first_name, last_name: t.last_name,
        title: t.title, country: t.country, city: t.city, state: t.state,
        organization_id: t.organization_id, org_name: org?.name ?? null,
      };
    });

  if (targets.length === 0) return ok({ requested: 0, matched: 0, archived: 0, missing_apollo_ids: [], credits_consumed: 0, verified: 0, unverified: 0, remaining: 0 });

  const stats = await enrichLeads(db, targets, 10);

  const baseUrl = internalAppBaseUrl(req);
  const secret = process.env.INTERNAL_SECRET;

  // Trigger org scraping AFTER enrichment — domains are now populated on orgs.
  if (stats.enriched_org_ids.length > 0 && secret && (await getServiceSecret("firecrawl"))) {
    after(() =>
      fetch(`${baseUrl}/api/enrich/scrape-orgs`, {
        method: "POST",
        headers: { "x-internal-secret": secret },
      }).catch(() => {})
    );
  }

  // This batch was capped at ENRICH_BATCH_SIZE — if the import still has more
  // unrevealed leads, self-trigger another pass. Mirrors scrape-orgs' own
  // self-continuation so a large import can never outrun the 300s function cap.
  if ("import_id" in parsed.data && secret) {
    const importId = parsed.data.import_id;
    const { count: importRemaining } = await db
      .from("leads").select("id", { count: "exact", head: true })
      .eq("import_id", importId)
      .eq("lead_source", "apollo").eq("has_email", true).is("email", null);
    if ((importRemaining ?? 0) > 0) {
      const authHeader = req.headers.get("authorization") ?? "";
      after(() =>
        fetch(`${baseUrl}/api/v1/leads/enrich`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": authHeader },
          body: JSON.stringify({ import_id: importId }),
        }).catch(() => {})
      );
    }
  }

  const { count: remaining } = await db
    .from("leads").select("id", { count: "exact", head: true })
    .eq("lead_source", "apollo").eq("has_email", true).is("email", null);

  return ok({
    requested: targets.length,
    matched: stats.matched,
    archived: stats.archived,
    missing_apollo_ids: stats.missing_apollo_ids,
    credits_consumed: stats.credits_consumed,
    verified: stats.verified,
    unverified: stats.unverified,
    remaining: remaining ?? 0,
    ...(stats.warning ? { warning: stats.warning } : {}),
  });
}
