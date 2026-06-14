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
    .select("id, status, lead_id, campaign_id")
    .eq("id", id)
    .maybeSingle();

  if (!oldDraft) return fail(404, "NOT_FOUND", "Draft not found");

  if (!["draft", "failed", "rejected"].includes(oldDraft.status)) {
    return fail(409, "CONFLICT", `Cannot regenerate a draft with status '${oldDraft.status}'`);
  }

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, name, human_in_loop")
    .eq("id", oldDraft.campaign_id)
    .maybeSingle();

  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");

  const { data: cl } = await db
    .from("campaign_leads")
    .select(`
      id, lead_id,
      leads(
        id, first_name, last_name, email, title, headline, seniority, country,
        organizations(name, domain, company_description, sells_to, description, primary_products, keywords)
      )
    `)
    .eq("campaign_id", oldDraft.campaign_id)
    .eq("lead_id", oldDraft.lead_id)
    .maybeSingle();

  if (!cl) return fail(404, "NOT_FOUND", "Campaign lead not found");

  await db.from("campaign_leads").update({
    draft_id: null,
    updated_at: new Date().toISOString(),
  }).eq("id", cl.id);

  await db.from("email_drafts").update({
    status: "rejected",
    rejection_reason: "superseded by regeneration",
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  const result = await generateOneDraft(
    db,
    cl,
    oldDraft.campaign_id,
    campaign.human_in_loop,
    campaign.name,
    user.id,
    parsed.data.custom_instruction,
  );

  if (!result.ok) return fail(500, "GENERATION_FAILED", result.reason);

  const { data: newDraft } = await db
    .from("email_drafts")
    .select("id, subject, body, status")
    .eq("id", result.draftId)
    .single();

  return ok({ draft: newDraft });
}
