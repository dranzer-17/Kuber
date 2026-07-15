import { NextRequest, after } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { internalAppBaseUrl } from "@/lib/internal-url";

// Bulk version of the single-org rescrape/retry — requeues every failed org,
// instead of managers clicking "retry" one company at a time (there was no
// bulk path before this, and failures pile up fast on a large import).
export async function POST(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const db = createAdminClient();

  // One UPDATE with the same WHERE the SELECT would have used — not a
  // select-ids-then-.in(ids) round trip. At batch scale that id list runs to
  // thousands of characters and can get silently dropped by an intermediary
  // (proxy/tunnel URL-length limit) with supabase-js never surfacing it as a
  // thrown error, so a prior version of this route reported success when
  // nothing had actually been requeued.
  //
  // No enrichment_attempts filter: the 3-attempt cap is for the automatic
  // retry loop only. "Retry all" is a deliberate manual action — usually
  // fired right after topping up OpenRouter/Firecrawl credits — so every
  // failed org gets reset to a fresh attempt budget rather than staying
  // stuck at MAX_ATTEMPTS forever.
  const { data: updated, error } = await db
    .from("organizations")
    .update({
      has_scraped: false,
      enrichment_stage: "queued",
      enrichment_status: "SCRAPE_QUEUED",
      enrichment_attempts: 0,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("enrichment_stage", "failed")
    .select("id");

  if (error) return fail(500, "INTERNAL", error.message);

  const ids = (updated ?? []).map((o) => o.id);
  if (ids.length === 0) return ok({ requeued: 0 });

  await db.from("enrichment_logs").insert({
    source: "system",
    event: "SCRAPE_QUEUED",
    payload: { total_orgs: ids.length, triggered_by: "retry_all" },
    created_at: new Date().toISOString(),
  });

  if (process.env.INTERNAL_SECRET) {
    const baseUrl = internalAppBaseUrl(req);
    const secret = process.env.INTERNAL_SECRET;
    after(() =>
      fetch(`${baseUrl}/api/enrich/scrape-orgs`, {
        method: "POST",
        headers: { "x-internal-secret": secret },
      }).catch(() => {})
    );
  }

  return ok({ requeued: ids.length });
}
