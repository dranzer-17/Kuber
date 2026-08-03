import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_ENRICH_ATTEMPTS } from "@/lib/services/enrich-leads";

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
 *  self-chain died mid-run (server restart, redeploy, function timeout) — the
 *  same kind of silent stall that org-scraping's watchdog above already guards
 *  against, but for the enrich stage, which has no other safety net.
 *
 *  DELIBERATELY NOT part of runEnrichmentWatchdog. This is the only background
 *  job in the app that can spend money, and it used to ride along with the
 *  15-minute watchdog: 96 chances a day for a defect to become a charge, which
 *  is precisely how one unresolvable lead cost ~420 credits in July 2026. It
 *  now runs on its own once-a-day schedule (cron job `resume-apollo-reveal`),
 *  so the blast radius of anything going wrong here is 1 pass instead of 96.
 *
 *  Waiting up to a day costs nothing real: the import's own self-chain already
 *  handles the normal case within seconds, and this is only the safety net for
 *  when that chain dies. Leads that arrive a day later are still leads. */
export async function triggerEnrichWatchdog(baseUrl: string, db: Db) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return;

  const { data: pending } = await db
    .from("leads")
    .select("import_id")
    .eq("lead_source", "apollo")
    .eq("has_email", true)
    // Deleted leads can never be claimed (claim_unenriched_leads refuses them),
    // so an import full of them stays "pending" forever and permanently holds
    // one of the five slots below — starving imports that could actually run.
    .eq("is_deleted", false)
    // Same circuit breaker as the enrich route: a lead that has already been
    // asked about three times must not keep waking this job up. Without it, one
    // permanently-unresolvable lead re-triggers a paid Apollo call every 15
    // minutes forever — 96 credits a day, which is exactly what happened
    // between 15 and 26 July 2026.
    .lt("enrich_attempts", MAX_ENRICH_ATTEMPTS)
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

/** Runs the nudges together — this is the whole job of the frequent watchdog.
 *
 *  Everything here is FREE: scraping is Firecrawl, draft regeneration is the
 *  LLM providers. No Apollo call can originate from this function, which is why
 *  it is safe to run every 15 minutes. The one paid job, triggerEnrichWatchdog,
 *  is deliberately excluded and runs on its own daily schedule. */
export async function runEnrichmentWatchdog(baseUrl: string, db: Db) {
  triggerScrapeWatchdog(baseUrl);
  await triggerRegenerationWatchdog(baseUrl, db);
}
