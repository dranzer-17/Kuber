import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { internalAppBaseUrl } from "@/lib/internal-url";
import { safeSecretEqual } from "@/lib/auth/secret";
import {
  fetchDraftTargets,
  generateOneDraft,
  countPendingDrafts,
} from "@/lib/services/generate-drafts";

export const maxDuration = 55;

export async function POST(req: NextRequest) {
  if (!safeSecretEqual(req.headers.get("x-internal-secret"), process.env.INTERNAL_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { campaign_id?: string; step_number?: number };
  const campaignId = body.campaign_id;
  const stepNumber = body.step_number ?? 1;
  if (!campaignId) {
    return Response.json({ error: "campaign_id required" }, { status: 400 });
  }

  const db = createAdminClient();

  // Self-heal: reset any stuck drafts/campaigns before proceeding
  try { await db.rpc("reset_stuck_draft_generation", { stale_minutes: 5 }); } catch { /* non-fatal */ }

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, name, human_in_loop, status, ai_prompt_context")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  const targets = await fetchDraftTargets(db, campaignId, 10, stepNumber);

  if (targets.length === 0) {
    const pending = await countPendingDrafts(db, campaignId);
    if (pending === 0) {
      await db.from("campaigns").update({
        status: "draft",
        updated_at: new Date().toISOString(),
      }).eq("id", campaignId);
    }
    return Response.json({ processed: 0, succeeded: 0, failed: 0, status: "no_more_pending" });
  }

  await db.from("campaigns").update({
    status: "processing",
    updated_at: new Date().toISOString(),
  }).eq("id", campaignId);

  let succeeded = 0;
  let failed = 0;

  for (const target of targets) {
    const result = await generateOneDraft(
      db,
      target,
      campaignId,
      campaign.human_in_loop,
      campaign.name,
      undefined,
      undefined,
      campaign.ai_prompt_context ?? undefined,
      undefined,
      stepNumber,
    );
    if (result.ok) succeeded++;
    else failed++;
  }

  const remaining = await countPendingDrafts(db, campaignId);

  if (remaining > 0) {
    const baseUrl = internalAppBaseUrl(req);
    fetch(`${baseUrl}/api/enrich/generate-drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_SECRET!,
      },
      body: JSON.stringify({ campaign_id: campaignId, step_number: stepNumber }),
    }).catch(() => {});
  } else {
    await db.from("campaigns").update({
      status: "draft",
      updated_at: new Date().toISOString(),
    }).eq("id", campaignId);
  }

  return Response.json({
    processed: targets.length,
    succeeded,
    failed,
    remaining,
  });
}
