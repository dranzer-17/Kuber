import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import {
  CAMPAIGN_BUCKET_LABELS,
  CAMPAIGN_KANBAN_COLS,
  campaignBucket,
  type CampaignKanbanBucket,
} from "@/lib/campaign-status";
import { assertCampaignAccess } from "@/lib/auth/scope";

type DraftRow = { status: string } | { status: string }[] | null;

function unwrapDraft(raw: DraftRow): { status: string } | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();
  try { await assertCampaignAccess(db, user, id); } catch (r) { return r as Response; }

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, sent_count, replied_count")
    .eq("id", id)
    .maybeSingle();

  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");

  const { data: rows } = await db
    .from("campaign_leads")
    .select("id, crm_status, draft_id, email_drafts(status)")
    .eq("campaign_id", id);

  const leads = rows ?? [];
  const bucketCounts: Record<CampaignKanbanBucket, number> = {
    pending: 0,
    draft: 0,
    approved: 0,
    sent: 0,
    replied: 0,
  };

  let draftsGenerated = 0;
  let certified = 0;
  let sent = 0;
  let failed = 0;
  let generating = 0;
  let pending = 0;
  let succeeded = 0;

  for (const row of leads) {
    const draft = unwrapDraft(row.email_drafts as DraftRow);
    const ds = draft?.status;
    if (ds && ds !== "generating") draftsGenerated++;
    if (ds === "approved") certified++;
    if (ds === "sent") sent++;
    if (ds === "failed") failed++;
    if (ds === "generating") generating++;
    if (!draft || !row.draft_id) pending++;
    if (ds === "draft" || ds === "approved" || ds === "sent") succeeded++;
    bucketCounts[campaignBucket(row)]++;
  }

  const replied = leads.filter((r) => r.crm_status === "replied").length;
  const sentTotal = Math.max(sent, campaign.sent_count ?? 0);
  const repliedTotal = Math.max(replied, campaign.replied_count ?? 0);

  const attempted = succeeded + failed;
  const successRate = attempted > 0 ? Math.round((succeeded / attempted) * 100) : 0;

  const stageDistribution = CAMPAIGN_KANBAN_COLS.map((col) => ({
    stage: col.id,
    label: CAMPAIGN_BUCKET_LABELS[col.id],
    count: bucketCounts[col.id],
  })).filter((s) => s.count > 0);

  return ok({
    campaignId: id,
    totals: {
      leads: leads.length,
      draftsGenerated,
      certified,
      sent: sentTotal,
      replied: repliedTotal,
      failed,
    },
    rates: {
      replyRate: sentTotal > 0 ? Math.round((repliedTotal / sentTotal) * 100) : 0,
      certifyRate: draftsGenerated > 0 ? Math.round((certified / draftsGenerated) * 100) : 0,
    },
    draftGeneration: {
      total: leads.length,
      pending,
      generating,
      succeeded,
      failed,
      successRate,
    },
    stageDistribution,
  });
}
