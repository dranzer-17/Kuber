import { NextRequest, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { safeSecretEqual } from "@/lib/auth/secret";
import { internalAppBaseUrl } from "@/lib/internal-url";

// A website that timed out or errored a few hours ago might just work now —
// unlike Apollo's "no email" answer (permanent, re-asking wastes a credit for
// the same non-answer), a site being temporarily down/slow is exactly the
// kind of failure worth trying again later. Meant to run every few hours
// (much less often than the enrichment-watchdog's 15-20 min "did the relay
// die?" check) since there's no urgency — this is opportunistic, not a stall
// recovery.
//
// Deliberately narrower than the manager-facing "Retry all" button:
// - Excludes NO_DOMAIN / NO_EMAILED_LEADS — retrying those changes nothing,
//   there's no new data for a fresh attempt to find.
// - Only orgs that failed a while ago (3h+), so this never fights with a
//   manual retry or the watchdog's own resumption of an active run.
// - Resets enrichment_attempts to 0 — a genuinely transient issue deserves a
//   full fresh set of 3 tries after a real gap, not to continue a stale count.
const STALE_FAILURE_HOURS = 3;

async function autoRetryStaleFailures(req: NextRequest) {
  const db = createAdminClient();
  const staleBefore = new Date(Date.now() - STALE_FAILURE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: candidates, error } = await db
    .from("organizations")
    .select("id")
    .eq("enrichment_stage", "failed")
    .not("enrichment_status", "in", '("NO_DOMAIN","NO_EMAILED_LEADS")')
    .not("domain", "is", null)
    .lt("updated_at", staleBefore);

  if (error) return fail(500, "INTERNAL", error.message);

  // Only orgs that still have someone worth contacting — same guard scrape-orgs
  // itself applies before spending credits.
  const withUsableLead: string[] = [];
  for (const org of candidates ?? []) {
    const { count } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.id)
      .eq("is_deleted", false)
      .or("email.not.is.null,has_email.eq.true");
    if ((count ?? 0) > 0) withUsableLead.push(org.id);
  }

  if (withUsableLead.length === 0) return ok({ requeued: 0 });

  const { data: updated } = await db
    .from("organizations")
    .update({
      has_scraped: false,
      enrichment_stage: "queued",
      enrichment_status: "SCRAPE_QUEUED",
      enrichment_attempts: 0,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .in("id", withUsableLead)
    .select("id");

  const requeuedIds = (updated ?? []).map((o) => o.id);
  if (requeuedIds.length === 0) return ok({ requeued: 0 });

  await db.from("enrichment_logs").insert({
    source: "system",
    event: "SCRAPE_QUEUED",
    payload: { total_orgs: requeuedIds.length, triggered_by: "auto_retry_stale_failures" },
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

  return ok({ requeued: requeuedIds.length });
}

export async function POST(req: NextRequest) {
  if (!safeSecretEqual(req.headers.get("x-internal-secret"), process.env.INTERNAL_SECRET)) {
    return fail(401, "UNAUTHORIZED", "Internal secret required");
  }
  return autoRetryStaleFailures(req);
}

/** GET for Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), same pattern as the other internal jobs. */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const cronToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const authorized =
    safeSecretEqual(cronToken, process.env.CRON_SECRET) ||
    safeSecretEqual(req.headers.get("x-internal-secret"), process.env.INTERNAL_SECRET);
  if (!authorized) {
    return fail(401, "UNAUTHORIZED", "Cron authorization required");
  }
  return autoRetryStaleFailures(req);
}
