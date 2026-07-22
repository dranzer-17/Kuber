import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { assertCampaignAccess } from "@/lib/auth/scope";
import { getLatestJob } from "@/lib/services/regeneration-jobs";

/**
 * The campaign's live regeneration job, or the most recent finished one.
 * Polled by the drawer while a run is in flight; also lets a user who reopens
 * the campaign later see how the last run ended.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();
  try { await assertCampaignAccess(db, user, id); } catch (r) { return r as Response; }

  const url = new URL(req.url);
  const stepNumber = Number(url.searchParams.get("step_number") ?? 1) || 1;

  const job = await getLatestJob(db, id, stepNumber);
  if (!job) return ok({ job: null });

  const processed = job.succeeded + job.failed;
  return ok({
    job: {
      ...job,
      processed,
      active: job.status === "queued" || job.status === "running",
    },
  });
}
