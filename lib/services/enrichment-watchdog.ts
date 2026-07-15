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

/** Runs both nudges together — this is the whole job of the frequent watchdog. */
export async function runEnrichmentWatchdog(baseUrl: string, db: Db) {
  triggerScrapeWatchdog(baseUrl);
  await triggerEnrichWatchdog(baseUrl, db);
}
