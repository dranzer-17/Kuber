import { createAdminClient } from "@/lib/supabase/admin";
import { fail } from "@/lib/api-response";
import type { AuthedUser } from "@/lib/auth/api-auth";

type Db = ReturnType<typeof createAdminClient>;

// Access model (planning.md Phase 2):
//   • Managers / super-admins see everything.
//   • An employee can access a CAMPAIGN they created OR were assigned
//     (campaigns.assigned_to).
//   • An employee can additionally access individual THREADS / reply drafts
//     whose lead is assigned to them, even inside someone else's campaign.

/** Throws a 404 Response unless the campaign exists and (for employees) is created by or assigned to them. */
export async function assertCampaignAccess(db: Db, user: AuthedUser, campaignId: string): Promise<void> {
  const { data } = await db
    .from("campaigns")
    .select("created_by, assigned_to")
    .eq("id", campaignId)
    .maybeSingle();
  if (!data) throw fail(404, "NOT_FOUND", "Campaign not found");
  if (user.role === "employee" && data.created_by !== user.id && data.assigned_to !== user.id) {
    throw fail(404, "NOT_FOUND", "Campaign not found");
  }
}

/** Campaign ids an employee may fully access (created by OR assigned to them). */
export async function getAccessibleCampaignIds(db: Db, user: AuthedUser): Promise<string[]> {
  const { data } = await db
    .from("campaigns")
    .select("id")
    .eq("is_deleted", false)
    .or(`created_by.eq.${user.id},assigned_to.eq.${user.id}`);
  return (data ?? []).map((c) => c.id as string);
}

/**
 * campaign_leads ids whose LEAD is assigned to this employee — grants
 * thread-level Unibox visibility inside campaigns they don't otherwise see
 * (the "manager kept the campaign but split its leads" pattern).
 */
export async function getAccessibleCampaignLeadIds(db: Db, user: AuthedUser): Promise<string[]> {
  const { data } = await db
    .from("campaign_leads")
    .select("id, leads!inner(assigned_to, is_deleted)")
    .eq("leads.assigned_to", user.id)
    .eq("leads.is_deleted", false);
  return (data ?? []).map((cl) => cl.id as string);
}

/** Unibox visibility boundary for an employee; null for managers (see everything). */
export async function getUniboxScope(
  db: Db,
  user: AuthedUser,
): Promise<{ campaign_ids: string[]; campaign_lead_ids: string[] } | null> {
  if (user.role !== "employee") return null;
  const [campaignIds, campaignLeadIds] = await Promise.all([
    getAccessibleCampaignIds(db, user),
    getAccessibleCampaignLeadIds(db, user),
  ]);
  return { campaign_ids: campaignIds, campaign_lead_ids: campaignLeadIds };
}

/**
 * Throws a 404 Response unless the caller may see a thread identified by its
 * campaign and/or campaign_lead: managers always; employees via campaign
 * access OR because the thread's lead is assigned to them.
 */
export async function assertThreadAccess(
  db: Db,
  user: AuthedUser,
  thread: { campaignId?: string | null; campaignLeadId?: string | null },
): Promise<void> {
  if (user.role !== "employee") return;

  if (thread.campaignId) {
    try {
      await assertCampaignAccess(db, user, thread.campaignId);
      return;
    } catch {
      // fall through to the lead-assignment check
    }
  }

  if (thread.campaignLeadId) {
    const { data: cl } = await db
      .from("campaign_leads")
      .select("id, leads!inner(assigned_to)")
      .eq("id", thread.campaignLeadId)
      .eq("leads.assigned_to", user.id)
      .maybeSingle();
    if (cl) return;
  }

  throw fail(404, "NOT_FOUND", "Thread not found");
}

/** assertThreadAccess, resolving the campaign/campaign_lead from a unibox thread id. */
export async function assertThreadAccessById(db: Db, user: AuthedUser, threadId: string): Promise<void> {
  if (user.role !== "employee") return;
  const { data: rows } = await db
    .from("unibox_emails")
    .select("campaign_id, campaign_lead_id")
    .eq("thread_id", threadId)
    .limit(20);
  if (!rows || rows.length === 0) throw fail(404, "NOT_FOUND", "Thread not found");

  // A thread's messages may be unevenly mapped — allow if ANY message grants access.
  for (const row of rows) {
    try {
      await assertThreadAccess(db, user, {
        campaignId: row.campaign_id as string | null,
        campaignLeadId: row.campaign_lead_id as string | null,
      });
      return;
    } catch {
      // try the next message
    }
  }
  throw fail(404, "NOT_FOUND", "Thread not found");
}

/**
 * Lead ids an employee may see because they have access to a campaign the
 * lead belongs to (created by or assigned to them) — the same broadened
 * visibility Unibox threads already grant. Without this, an employee could
 * work a reply thread for a lead (via campaign access) but couldn't open the
 * underlying Lead record at all — a real, user-facing inconsistency
 * (planning review §3.1 / §4.1).
 */
export async function getCampaignAccessibleLeadIds(db: Db, user: AuthedUser): Promise<string[]> {
  if (user.role !== "employee") return [];
  const campaignIds = await getAccessibleCampaignIds(db, user);
  if (campaignIds.length === 0) return [];
  const { data } = await db.from("campaign_leads").select("lead_id").in("campaign_id", campaignIds);
  return [...new Set((data ?? []).map((r) => r.lead_id as string))];
}

/**
 * Throws a 404 Response unless the lead is visible to the caller: managers
 * always; employees when the lead is directly assigned to them OR they have
 * access to a campaign it belongs to. This is a VIEW check only — editing a
 * lead (PATCH) stays restricted to direct assignment, a separate, stricter
 * permission (see leads/[id]/route.ts).
 */
export async function assertLeadAccess(db: Db, user: AuthedUser, leadId: string): Promise<void> {
  const { data } = await db.from("leads").select("assigned_to").eq("id", leadId).maybeSingle();
  if (!data) throw fail(404, "NOT_FOUND", "Lead not found");
  if (user.role !== "employee") return;
  if (data.assigned_to === user.id) return;
  const accessibleIds = await getCampaignAccessibleLeadIds(db, user);
  if (accessibleIds.includes(leadId)) return;
  throw fail(404, "NOT_FOUND", "Lead not found");
}

/** Throws a 404 Response unless the email_drafts row exists and (for employees) its campaign is accessible. */
export async function assertDraftAccess(db: Db, user: AuthedUser, draftId: string): Promise<void> {
  const { data } = await db.from("email_drafts").select("campaign_id").eq("id", draftId).maybeSingle();
  if (!data) throw fail(404, "NOT_FOUND", "Draft not found");
  await assertCampaignAccess(db, user, data.campaign_id);
}

/**
 * Throws a 404 Response unless the reply_drafts row exists and the caller may
 * work it: managers always; employees via campaign access OR because the
 * underlying lead is assigned to them.
 */
export async function assertReplyDraftAccess(db: Db, user: AuthedUser, replyDraftId: string): Promise<void> {
  const { data } = await db
    .from("reply_drafts")
    .select("campaign_id, campaign_lead_id")
    .eq("id", replyDraftId)
    .maybeSingle();
  if (!data) throw fail(404, "NOT_FOUND", "Reply draft not found");
  if (user.role !== "employee") return;

  if (data.campaign_id) {
    try {
      await assertCampaignAccess(db, user, data.campaign_id);
      return;
    } catch {
      // fall through to the lead-assignment check
    }
  }

  if (data.campaign_lead_id) {
    const { data: cl } = await db
      .from("campaign_leads")
      .select("id, leads!inner(assigned_to)")
      .eq("id", data.campaign_lead_id)
      .eq("leads.assigned_to", user.id)
      .maybeSingle();
    if (cl) return;
  }

  throw fail(404, "NOT_FOUND", "Reply draft not found");
}
