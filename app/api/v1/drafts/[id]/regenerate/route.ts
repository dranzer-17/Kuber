import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { RegenerateDraftSchema } from "@/lib/validators/drafts";
import { generateOneDraft } from "@/lib/services/generate-drafts";

export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = RegenerateDraftSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  const { data: oldDraft } = await db
    .from("email_drafts")
    .select("id, status, lead_id, campaign_id, version")
    .eq("id", id)
    .maybeSingle();

  if (!oldDraft) return fail(404, "NOT_FOUND", "Draft not found");

  if (!["draft", "failed", "rejected", "approved"].includes(oldDraft.status)) {
    return fail(409, "CONFLICT", `Cannot regenerate a draft with status '${oldDraft.status}'`);
  }

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, name, human_in_loop, ai_prompt_context")
    .eq("id", oldDraft.campaign_id)
    .maybeSingle();

  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");

  const { data: cl } = await db
    .from("campaign_leads")
    .select(`
      id, lead_id,
      leads(
        id, first_name, last_name, email, title, headline, seniority, country,
        organizations(name, domain, company_description, sells_to, keywords)
      )
    `)
    .eq("campaign_id", oldDraft.campaign_id)
    .eq("lead_id", oldDraft.lead_id)
    .maybeSingle();

  if (!cl) return fail(404, "NOT_FOUND", "Campaign lead not found");

  await db.from("email_drafts").update({
    status: "rejected",
    rejection_reason: "superseded by regeneration",
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  const nextVersion = (oldDraft.version ?? 1) + 1;
  const { data: newDraftRow, error: insertErr } = await db
    .from("email_drafts")
    .insert({
      lead_id: oldDraft.lead_id,
      campaign_id: oldDraft.campaign_id,
      status: "generating",
      version: nextVersion,
      parent_draft_id: oldDraft.id,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !newDraftRow) return fail(500, "INTERNAL", insertErr?.message ?? "Failed to create draft row");

  await db.from("campaign_leads").update({
    draft_id: newDraftRow.id,
    updated_at: new Date().toISOString(),
  }).eq("id", cl.id);

  const result = await generateOneDraft(
    db,
    cl,
    oldDraft.campaign_id,
    campaign.human_in_loop,
    campaign.name,
    user.id,
    parsed.data.custom_instruction,
    campaign.ai_prompt_context ?? undefined,
    newDraftRow.id,
  );

  if (!result.ok) return fail(500, "GENERATION_FAILED", result.reason);

  const { data: newDraft } = await db
    .from("email_drafts")
    .select("id, subject, body, status, version")
    .eq("id", result.draftId)
    .single();

  return ok({ draft: newDraft });
}
