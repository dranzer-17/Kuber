import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchDraftSchema } from "@/lib/validators/drafts";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchDraftSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  const { data: draft } = await db
    .from("email_drafts")
    .select("id, status, lead_id, campaign_id")
    .eq("id", id)
    .maybeSingle();

  if (!draft) return fail(404, "NOT_FOUND", "Draft not found");

  const now = new Date().toISOString();

  if (parsed.data.action === "approve") {
    if (draft.status !== "draft") return fail(409, "CONFLICT", `Cannot approve a draft with status '${draft.status}'`);

    await db.from("email_drafts").update({ status: "approved", approved_at: now, reviewed_by: user.id, updated_at: now }).eq("id", id);
    await db.from("campaign_leads").update({ crm_status: "approved", updated_at: now }).eq("draft_id", id);
    return ok({ id, status: "approved" });
  }

  if (parsed.data.action === "reject") {
    if (!["draft", "approved"].includes(draft.status)) return fail(409, "CONFLICT", `Cannot reject a draft with status '${draft.status}'`);

    await db.from("email_drafts").update({ status: "rejected", rejection_reason: parsed.data.rejection_reason, updated_at: now }).eq("id", id);
    await db.from("campaign_leads").update({ crm_status: "enriched", draft_id: null, updated_at: now }).eq("draft_id", id);
    return ok({ id, status: "rejected" });
  }

  if (parsed.data.action === "edit") {
    if (draft.status === "approved") return fail(409, "CONFLICT", "Cannot edit an approved draft — reject it first");

    await db.from("email_drafts").update({ subject: parsed.data.subject, body: parsed.data.body, status: "draft", updated_at: now }).eq("id", id);
    return ok({ id, status: "draft" });
  }

  return fail(400, "VALIDATION_ERROR", "Unknown action");
}
