import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { BulkApproveSchema } from "@/lib/validators/drafts";
import { syncApprovedDraftToInstantly } from "@/lib/services/draft-sync";
import { assertCampaignAccess } from "@/lib/auth/scope";
import { logLeadEvent } from "@/lib/services/lead-events";

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = BulkApproveSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();
  const now = new Date().toISOString();

  let approved = 0;
  let skipped = 0;

  for (const draftId of parsed.data.draft_ids) {
    const { data: draft } = await db
      .from("email_drafts")
      .select("id, status, lead_id, campaign_id")
      .eq("id", draftId)
      .maybeSingle();

    if (!draft || draft.status !== "draft") {
      skipped++;
      continue;
    }

    try { await assertCampaignAccess(db, user, draft.campaign_id); } catch { skipped++; continue; }

    await db.from("email_drafts").update({
      status: "approved",
      approved_at: now,
      reviewed_by: user.id,
      updated_at: now,
    }).eq("id", draftId);

    await db.from("campaign_leads").update({
      crm_status: "approved",
      updated_at: now,
    }).eq("draft_id", draftId);

    await syncApprovedDraftToInstantly(db, draft.lead_id, draft.campaign_id);

    await logLeadEvent(db, draft.lead_id, "draft_approved", "Email draft approved", {
      actorId: user.id,
      metadata: { campaign_id: draft.campaign_id, draft_id: draftId, bulk: true },
    });

    approved++;
  }

  return ok({ approved, skipped });
}
