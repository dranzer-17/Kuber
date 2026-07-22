import { NextRequest, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { internalAppBaseUrl } from "@/lib/internal-url";
import { safeSecretEqual } from "@/lib/auth/secret";
import { regenerateOneDraft, BULK_REGENERATABLE_STATUSES } from "@/lib/services/regenerate-draft";
import { countPendingItems } from "@/lib/services/regeneration-jobs";

export const maxDuration = 55;

// Regeneration is one LLM call per lead and the single-draft route budgets 60s
// for one of them, so five sequential calls is the safe ceiling for a 55s
// invocation. The job self-chains, so a small batch costs nothing but an extra
// round trip.
const BATCH_SIZE = 5;

/**
 * Batch worker for bulk draft regeneration.
 *
 * Claims a few pending items, regenerates each through the same routine the
 * single-draft route uses (so version history is identical), then re-triggers
 * itself until the job is finished. Mirrors /api/enrich/generate-drafts.
 */
export async function POST(req: NextRequest) {
  if (!safeSecretEqual(req.headers.get("x-internal-secret"), process.env.INTERNAL_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { job_id?: string };
  const jobId = body.job_id;
  if (!jobId) return Response.json({ error: "job_id required" }, { status: 400 });

  const db = createAdminClient();

  const { data: job } = await db
    .from("draft_regeneration_jobs")
    .select("id, campaign_id, status, custom_instruction, requested_by, succeeded, failed")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

  // Cancelled between batches — stop without touching anything further.
  if (job.status === "cancelled" || job.status === "completed" || job.status === "failed") {
    return Response.json({ processed: 0, status: job.status });
  }

  const now = new Date().toISOString();
  if (job.status === "queued") {
    await db.from("draft_regeneration_jobs").update({
      status: "running",
      started_at: now,
      heartbeat_at: now,
    }).eq("id", jobId);
  }

  const { data: items } = await db
    .from("draft_regeneration_job_items")
    .select("id, campaign_lead_id, lead_id")
    .eq("job_id", jobId)
    .eq("status", "pending")
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);

  if (!items || items.length === 0) {
    await finishJob(db, jobId);
    return Response.json({ processed: 0, status: "no_more_pending" });
  }

  await db
    .from("draft_regeneration_job_items")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .in("id", items.map((i) => i.id));

  let succeeded = 0;
  let failed = 0;

  for (const item of items) {
    // The draft to regenerate is whatever campaign_leads points at NOW, not a
    // draft id captured at enqueue time — the user may have edited or the
    // generator may have replaced it during the minutes this job has been queued.
    const { data: cl } = await db
      .from("campaign_leads")
      .select("draft_id")
      .eq("id", item.campaign_lead_id)
      .maybeSingle();

    if (!cl?.draft_id) {
      await markItem(db, item.id, "skipped", "Lead no longer has a draft");
      continue;
    }

    const result = await regenerateOneDraft(db, cl.draft_id, {
      userId: job.requested_by ?? undefined,
      customInstruction: job.custom_instruction ?? undefined,
      bulkJobId: jobId,
      // Re-checked per lead, not just at enqueue: a draft certified or sent
      // while the job was queued must not be overwritten by it.
      allowedStatuses: BULK_REGENERATABLE_STATUSES,
    });

    if (result.ok) {
      await markItem(db, item.id, "done", null);
      succeeded++;
    } else if (result.code === "CONFLICT") {
      await markItem(db, item.id, "skipped", result.reason);
    } else {
      await markItem(db, item.id, "failed", result.reason);
      failed++;
    }
  }

  const { data: fresh } = await db
    .from("draft_regeneration_jobs")
    .select("status, succeeded, failed")
    .eq("id", jobId)
    .maybeSingle();

  await db.from("draft_regeneration_jobs").update({
    succeeded: (fresh?.succeeded ?? 0) + succeeded,
    failed: (fresh?.failed ?? 0) + failed,
    heartbeat_at: new Date().toISOString(),
  }).eq("id", jobId);

  // Cancellation lands while a batch is in flight; honour it before chaining.
  if (fresh?.status === "cancelled") {
    return Response.json({ processed: items.length, succeeded, failed, status: "cancelled" });
  }

  const remaining = await countPendingItems(db, jobId);

  if (remaining > 0 && process.env.INTERNAL_SECRET) {
    const baseUrl = internalAppBaseUrl(req);
    const secret = process.env.INTERNAL_SECRET;
    // after() keeps the lambda alive until the next kickoff leaves the machine,
    // so a long run doesn't silently stop halfway.
    after(async () => {
      await fetch(`${baseUrl}/api/enrich/regenerate-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": secret },
        body: JSON.stringify({ job_id: jobId }),
      }).catch(() => {});
    });
  } else if (remaining === 0) {
    await finishJob(db, jobId);
  }

  return Response.json({ processed: items.length, succeeded, failed, remaining });
}

async function markItem(
  db: ReturnType<typeof createAdminClient>,
  itemId: string,
  status: "done" | "failed" | "skipped",
  error: string | null,
) {
  await db.from("draft_regeneration_job_items").update({
    status,
    error,
    updated_at: new Date().toISOString(),
  }).eq("id", itemId);
}

/** Close out a job, unless it was cancelled — that status is the user's, not ours to overwrite. */
async function finishJob(db: ReturnType<typeof createAdminClient>, jobId: string) {
  await db.from("draft_regeneration_jobs").update({
    status: "completed",
    finished_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
  }).eq("id", jobId).in("status", ["queued", "running"]);
}
