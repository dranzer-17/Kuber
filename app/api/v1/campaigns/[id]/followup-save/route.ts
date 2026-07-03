import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { FollowUpSaveSchema } from "@/lib/validators/drafts";
import { syncApprovedDraftToInstantly } from "@/lib/services/draft-sync";

// Save for a follow-up: persist + approve + sync to Instantly in one atomic
// action, entirely separate from /drafts/[id] PATCH (whose "edit" action
// requires a non-empty subject — follow-ups are always empty so they thread
// as a reply, which made that shared action silently 400 on every follow-up
// save). Creates the draft row if none exists yet (a manual write), or
// updates the existing one in place otherwise — never bumps a new version,
// since this is editing the same email, not asking the AI to rewrite it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = FollowUpSaveSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  const { data: cl } = await db
    .from("campaign_leads")
    .select("id, lead_id, campaign_id")
    .eq("id", parsed.data.campaign_lead_id)
    .eq("campaign_id", id)
    .maybeSingle();

  if (!cl) return fail(404, "NOT_FOUND", "Campaign lead not found");

  const now = new Date().toISOString();

  const { data: existing } = await db
    .from("email_drafts")
    .select("id")
    .eq("campaign_id", id)
    .eq("lead_id", cl.lead_id)
    .eq("step_number", parsed.data.step_number)
    .not("status", "in", "(rejected,failed)")
    .maybeSingle();

  let draftId: string;

  if (existing) {
    const { error } = await db.from("email_drafts").update({
      subject: parsed.data.subject,
      body: parsed.data.body,
      status: "approved",
      approved_at: now,
      updated_at: now,
    }).eq("id", existing.id);
    if (error) return fail(500, "INTERNAL", error.message);
    draftId = existing.id;
  } else {
    const { data: draft, error } = await db
      .from("email_drafts")
      .insert({
        lead_id: cl.lead_id,
        campaign_id: id,
        step_number: parsed.data.step_number,
        subject: parsed.data.subject,
        body: parsed.data.body,
        status: "approved",
        approved_at: now,
        created_at: now,
      })
      .select("id")
      .single();
    if (error || !draft) return fail(500, "INTERNAL", error?.message ?? "Failed to save draft");
    draftId = draft.id;
  }

  const instantlySync = await syncApprovedDraftToInstantly(db, cl.lead_id, id);

  const { data: finalDraft } = await db
    .from("email_drafts")
    .select("id, subject, body, status")
    .eq("id", draftId)
    .single();

  return ok({ draft: finalDraft, instantly_sync: instantlySync });
}
