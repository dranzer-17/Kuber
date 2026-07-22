import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

/** Nudge the scrape worker so its watchdogs (stuck scraping / stale queued)
 *  run even on an otherwise idle day. */
export function triggerScrapeWatchdog(baseUrl: string) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) return;
  void fetch(`${baseUrl}/api/enrich/scrape-orgs`, {
    method: "POST",
    headers: { "x-internal-secret": secret },
  }).catch(() => {});
}

/** Resume email-reveal (`/api/v1/leads/enrich`) for any Apollo import whose
 *  self-chain died mid-run (dev server restart, tunnel drop, etc.) — the same
 *  kind of silent stall that org-scraping's watchdog above already guards
 *  against, but for the enrich stage, which has no other safety net. */
export async function triggerEnrichWatchdog(baseUrl: string, db: Db) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return;

  const { data: pending } = await db
    .from("leads")
    .select("import_id")
    .eq("lead_source", "apollo")
    .eq("has_email", true)
    .is("email", null)
    .not("import_id", "is", null);

  const importIds = [...new Set((pending ?? []).map((r) => r.import_id as string))].slice(0, 5);
  if (importIds.length === 0) return;

  for (const importId of importIds) {
    void fetch(`${baseUrl}/api/v1/leads/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({ import_id: importId }),
    }).catch(() => {});
  }
}

/** A running regeneration job is considered stalled once its heartbeat is this old. */
const REGEN_STALE_MINUTES = 5;

/** Revive bulk draft-regeneration jobs whose batch self-chain died mid-run —
 *  the same failure mode the two watchdogs above exist for. Each batch bumps
 *  heartbeat_at, so a 'running' job that has gone quiet lost its chain: reset
 *  the items it had claimed and kick it again. Without this, a job stalls
 *  forever AND holds uq_draft_regen_active_job, blocking every future run on
 *  that campaign. */
export async function triggerRegenerationWatchdog(baseUrl: string, db: Db) {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) return;

  const staleBefore = new Date(Date.now() - REGEN_STALE_MINUTES * 60 * 1000).toISOString();

  const { data: stalled } = await db
    .from("draft_regeneration_jobs")
    .select("id")
    .in("status", ["queued", "running"])
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${staleBefore}`)
    .lt("created_at", staleBefore)
    .limit(5);

  for (const job of stalled ?? []) {
    // Items left 'running' belong to the batch that died; put them back in the
    // queue. Anything already done/failed keeps its outcome.
    await db
      .from("draft_regeneration_job_items")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("job_id", job.id)
      .eq("status", "running");

    void fetch(`${baseUrl}/api/enrich/regenerate-drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ job_id: job.id }),
    }).catch(() => {});
  }
}

/** Runs the nudges together — this is the whole job of the frequent watchdog. */
export async function runEnrichmentWatchdog(baseUrl: string, db: Db) {
  triggerScrapeWatchdog(baseUrl);
  await triggerEnrichWatchdog(baseUrl, db);
  await triggerRegenerationWatchdog(baseUrl, db);
}
