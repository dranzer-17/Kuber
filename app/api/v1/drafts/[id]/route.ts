import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchDraftSchema } from "@/lib/validators/drafts";
import { syncApprovedDraftToInstantly } from "@/lib/services/draft-sync";
import { assertDraftAccess } from "@/lib/auth/scope";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchDraftSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();
  try { await assertDraftAccess(db, user, id); } catch (r) { return r as Response; }

  const { data: draft } = await db
    .from("email_drafts")
    .select("id, status, lead_id, campaign_id, step_number")
    .eq("id", id)
    .maybeSingle();

  if (!draft) return fail(404, "NOT_FOUND", "Draft not found");

  const now = new Date().toISOString();
  const isFollowUp = (draft.step_number ?? 1) > 1;

  if (parsed.data.action === "approve") {
    if (draft.status !== "draft") return fail(409, "CONFLICT", `Cannot approve a draft with status '${draft.status}'`);

    await db.from("email_drafts").update({ status: "approved", approved_at: now, reviewed_by: user.id, updated_at: now }).eq("id", id);
    // Follow-ups never own campaign_leads.draft_id (see generateOneDraft), so
    // this naturally no-ops for them — only step 1 drives the primary status.
    await db.from("campaign_leads").update({ crm_status: "approved", updated_at: now }).eq("draft_id", id);
    await syncApprovedDraftToInstantly(db, draft.lead_id, draft.campaign_id);
    return ok({ id, status: "approved" });
  }

  if (parsed.data.action === "reject") {
    if (!["draft", "approved"].includes(draft.status)) return fail(409, "CONFLICT", `Cannot reject a draft with status '${draft.status}'`);

    await db.from("email_drafts").update({ status: "rejected", rejection_reason: parsed.data.rejection_reason, updated_at: now }).eq("id", id);
    await db.from("campaign_leads").update({ crm_status: "enriched", draft_id: null, updated_at: now }).eq("draft_id", id);
    return ok({ id, status: "rejected" });
  }

  if (parsed.data.action === "edit") {
    if (draft.status === "approved") return fail(409, "CONFLICT", "Cannot edit an approved draft — reopen it first");

    await db.from("email_drafts").update({ subject: parsed.data.subject, body: parsed.data.body, status: "draft", updated_at: now }).eq("id", id);
    return ok({ id, status: "draft" });
  }

  if (parsed.data.action === "reopen") {
    if (draft.status !== "approved") return fail(409, "CONFLICT", `Cannot reopen a draft with status '${draft.status}'`);

    await db.from("email_drafts").update({
      status: "draft",
      approved_at: null,
      reviewed_by: null,
      updated_at: now,
    }).eq("id", id);
    await db.from("campaign_leads").update({ crm_status: "draft", updated_at: now }).eq("draft_id", id);
    return ok({ id, status: "draft" });
  }

  if (parsed.data.action === "restore") {
    const { data: target } = await db
      .from("email_drafts")
      .select("id, lead_id, campaign_id, status")
      .eq("id", id)
      .maybeSingle();

    if (!target || target.lead_id !== draft.lead_id || target.campaign_id !== draft.campaign_id) {
      return fail(404, "NOT_FOUND", "Version not found in this draft chain");
    }

    if (target.status === "rejected") {
      await db.from("email_drafts").update({ status: "draft", updated_at: now }).eq("id", id);
    }

    // Same rule as everywhere else: only a step-1 restore may move the lead's
    // primary crm_status/draft_id — a follow-up's own version history must
    // never touch it.
    if (!isFollowUp) {
      await db.from("campaign_leads").update({
        draft_id: id,
        crm_status: target.status === "approved" ? "approved" : "draft",
        updated_at: now,
      }).eq("campaign_id", draft.campaign_id).eq("lead_id", draft.lead_id);
    }

    return ok({ id, status: target.status === "approved" ? "approved" : "draft" });
  }

  return fail(400, "VALIDATION_ERROR", "Unknown action");
}
