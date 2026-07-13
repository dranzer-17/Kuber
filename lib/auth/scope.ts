import { createAdminClient } from "@/lib/supabase/admin";
import { fail } from "@/lib/api-response";
import type { AuthedUser } from "@/lib/auth/api-auth";

type Db = ReturnType<typeof createAdminClient>;

/** Throws a 404 Response unless the campaign exists and (for employees) belongs to them. */
export async function assertCampaignAccess(db: Db, user: AuthedUser, campaignId: string): Promise<void> {
  const { data } = await db.from("campaigns").select("created_by").eq("id", campaignId).maybeSingle();
  if (!data) throw fail(404, "NOT_FOUND", "Campaign not found");
  if (user.role === "employee" && data.created_by !== user.id) throw fail(404, "NOT_FOUND", "Campaign not found");
}

/** Throws a 404 Response unless the lead exists and (for employees) is assigned to them. */
export async function assertLeadAccess(db: Db, user: AuthedUser, leadId: string): Promise<void> {
  const { data } = await db.from("leads").select("assigned_to").eq("id", leadId).maybeSingle();
  if (!data) throw fail(404, "NOT_FOUND", "Lead not found");
  if (user.role === "employee" && data.assigned_to !== user.id) throw fail(404, "NOT_FOUND", "Lead not found");
}

/** Throws a 404 Response unless the email_drafts row exists and (for employees) its campaign belongs to them. */
export async function assertDraftAccess(db: Db, user: AuthedUser, draftId: string): Promise<void> {
  const { data } = await db.from("email_drafts").select("campaign_id").eq("id", draftId).maybeSingle();
  if (!data) throw fail(404, "NOT_FOUND", "Draft not found");
  await assertCampaignAccess(db, user, data.campaign_id);
}

/** Throws a 404 Response unless the reply_drafts row exists and (for employees) its campaign belongs to them. */
export async function assertReplyDraftAccess(db: Db, user: AuthedUser, replyDraftId: string): Promise<void> {
  const { data } = await db.from("reply_drafts").select("campaign_id").eq("id", replyDraftId).maybeSingle();
  if (!data) throw fail(404, "NOT_FOUND", "Reply draft not found");
  if (data.campaign_id) await assertCampaignAccess(db, user, data.campaign_id);
}
