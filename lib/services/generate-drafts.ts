import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { complete } from "@/lib/services/llm";
import {
  getDraftSystemPrompt,
  resolveCampaignSignature,
  getEmailTemplate,
  getProductSections,
} from "@/lib/services/settings";
import { KUBER_CONTEXT, type KuberProductMatch } from "@/lib/constants";

const DraftSchema = z.object({
  subject: z.string(),
  opening: z.string(),
  product_match: z.enum(["black", "white", "color", "additive", "none"]),
});

type DraftLLMOutput = z.infer<typeof DraftSchema>;

type OrgData = {
  name?: string | null;
  domain?: string | null;
  company_description?: string | null;
  sells_to?: string | null;
  keywords?: string[] | null;
};

type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  headline: string | null;
  seniority: string | null;
  country: string | null;
  organizations: OrgData | OrgData[] | null;
};

export type CampaignLeadTarget = {
  id: string;
  lead_id: string;
  attachment_name?: string | null;
  leads: LeadRow | LeadRow[] | null;
};

function unwrapOrg(raw: OrgData | OrgData[] | null | undefined): OrgData | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function unwrapLead(raw: LeadRow | LeadRow[] | null | undefined): LeadRow | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

// The base company intro, offerings, and closing are a client-approved fixed template
// (editable in Settings, stored in the `settings` table) — the LLM only personalizes
// the opening line and picks the best-fit product addendum, it does not write the
// full email body.
function buildTemplateInstruction(productSections: Awaited<ReturnType<typeof getProductSections>>): string {
  return (
    "\n\nIMPORTANT — this is NOT a freeform email. You are writing two small pieces that slot into a " +
    "fixed, client-approved template:\n" +
    '1. "subject": a short, personalized subject line referencing the lead\'s company.\n' +
    '2. "opening": 2-4 sentences ONLY. Address the lead by first name if given, otherwise "there". ' +
    "Reference something specific about their company (what they make/sell, from the facts given) and " +
    "naturally bridge into why Kuber Polyplast's masterbatches are relevant to them. " +
    "Do NOT restate Kuber's company info, certifications, production capacity, or client list — that is " +
    "appended automatically. Do NOT include a greeting line like 'Dear X' (added automatically). " +
    "Do NOT include a sign-off, signature, or any bracketed placeholders like [Your Name].\n" +
    '3. "product_match": pick exactly one of "black", "white", "color", "additive", or "none" — ' +
    "whichever masterbatch type best fits this company's business, based on the facts given. " +
    "Use \"none\" only if there is no reasonable fit.\n" +
    `Fit guide:\n- black: ${productSections.black.hint}\n- white: ${productSections.white.hint}\n- color: ${productSections.color.hint}\n- additive: ${productSections.additive.hint}`
  );
}

function buildUserPrompt(
  lead: LeadRow,
  campaignName: string,
  customInstruction?: string,
  aiPromptContext?: string,
  stepNumber = 1,
): string {
  const org = unwrapOrg(lead.organizations);
  const lines = [
    `Campaign: "${campaignName}"`,
    `Email step: ${stepNumber} of 3${stepNumber > 1 ? ` — this is a follow-up to a previous cold email the prospect did not reply to` : ""}`,
    `Name: ${[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown"}`,
    `Title: ${lead.title ?? lead.headline ?? "Unknown"}`,
    `Seniority: ${lead.seniority ?? "Unknown"}`,
    `Country: ${lead.country ?? "Unknown"}`,
    `Company: ${org?.name ?? "Unknown"}`,
    `Website: ${org?.domain ? `https://${org.domain}` : "N/A"}`,
    `What they do: ${org?.company_description ?? "Not available"}`,
    `Their end markets / customers: ${org?.sells_to ?? "Not available"}`,
    `Keywords: ${(org?.keywords ?? []).join(", ") || "Not available"}`,
    `Kuber context: ${KUBER_CONTEXT}`,
  ];
  if (aiPromptContext?.trim()) lines.push(`Campaign context: ${aiPromptContext.trim()}`);
  if (customInstruction) lines.push(`Additional instruction: ${customInstruction}`);
  return lines.join("\n");
}

/** Generate one draft for a campaign lead. Returns draft id on success. */
export async function generateOneDraft(
  db: SupabaseClient,
  target: CampaignLeadTarget,
  campaignId: string,
  humanInLoop: boolean,
  campaignName: string,
  userId?: string,
  customInstruction?: string,
  aiPromptContext?: string,
  existingDraftId?: string,
  stepNumber = 1,
): Promise<{ ok: true; draftId: string; status: string } | { ok: false; reason: string }> {
  const lead = unwrapLead(target.leads);
  if (!lead) return { ok: false, reason: "Lead not found" };
  if (!lead.email) return { ok: false, reason: "Lead has no email" };

  // --- Fetch full campaign for signature + attachment resolution ---
  const { data: campaign } = await db
    .from("campaigns")
    .select("id, signature_override, signature_user_id, created_by, attachment_name, ai_prompt_context")
    .eq("id", campaignId)
    .maybeSingle();

  const signatureBlock = await resolveCampaignSignature(db, campaign ?? {});

  // Per-lead attachment overrides campaign default. The brochure-attachment sentence
  // lives in the fixed closing template (lib/constants.ts), not something the LLM writes.
  const effectiveAttachmentName = target.attachment_name ?? campaign?.attachment_name ?? null;

  // --- Draft row (insert or reuse) ---
  let draftId = existingDraftId;

  if (!draftId) {
    const { data: draft, error: dErr } = await db
      .from("email_drafts")
      .insert({
        lead_id: lead.id,
        campaign_id: campaignId,
        step_number: stepNumber,
        status: "generating",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (dErr || !draft) return { ok: false, reason: dErr?.message ?? "Failed to create draft" };
    draftId = draft.id;
  }

  if (!draftId) return { ok: false, reason: "No draft row created" };

  const activeDraftId = draftId;

  try {
    const [baseSystemPrompt, emailTemplate, productSections] = await Promise.all([
      getDraftSystemPrompt(db),
      getEmailTemplate(db),
      getProductSections(db),
    ]);
    // Assemble full system prompt with campaign context + fixed-template instructions
    const systemPrompt =
      baseSystemPrompt
      + (aiPromptContext ? `\n\nAdditional campaign context:\n${aiPromptContext}` : "")
      + buildTemplateInstruction(productSections);

    const { json } = await complete<DraftLLMOutput>({
      system: systemPrompt,
      user: buildUserPrompt(lead, campaignName, customInstruction, aiPromptContext, stepNumber),
    });

    const validated = DraftSchema.safeParse(json);
    if (!validated.success) throw new Error("Draft shape mismatch");

    // Approach B safety net — remove any placeholder the LLM emitted anyway:
    let opening = validated.data.opening.trim();
    opening = opening
      .replace(/\[Your Name\]/gi, "")
      .replace(/\[Your (Title|Position)\]/gi, "")
      .replace(/\[Your Contact Information\]/gi, "")
      .replace(/\[Your Company\]/gi, "")
      .replace(/^dear[^,\n]*,?\s*/i, "")
      // Strip trailing sign-off the LLM adds despite instructions
      .replace(/\n+\s*(best regards|regards|sincerely|warm regards|thanks|thank you|cheers)[.,]?\s*$/i, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const greetingName = lead.first_name?.trim();
    const greeting = greetingName ? `Dear ${greetingName},` : "Dear Sir/Ma'am,";

    const productMatch = validated.data.product_match as KuberProductMatch;
    const productSection = productMatch !== "none" ? productSections[productMatch].section : null;

    const closing = effectiveAttachmentName
      ? emailTemplate.closingWithAttachment
      : emailTemplate.closingNoAttachment;

    const bodyParts = [
      greeting,
      opening,
      emailTemplate.intro,
      emailTemplate.offerings,
      ...(productSection ? [productSection] : []),
      closing,
      signatureBlock,
    ];

    const finalBody = bodyParts.join("\n\n");

    const finalStatus = humanInLoop ? "draft" : "approved";
    const now = new Date().toISOString();

    await db.from("email_drafts").update({
      subject: validated.data.subject,
      body: finalBody,
      status: finalStatus,
      ...(finalStatus === "approved" ? { approved_at: now, reviewed_by: userId ?? null } : {}),
      updated_at: now,
    }).eq("id", activeDraftId);

    await db.from("campaign_leads").update({
      draft_id: activeDraftId,
      crm_status: finalStatus === "approved" ? "approved" : "draft",
      updated_at: now,
    }).eq("id", target.id);

    return { ok: true, draftId: activeDraftId, status: finalStatus };
  } catch (err) {
    const now = new Date().toISOString();
    await db.from("email_drafts").update({
      status: "failed",
      updated_at: now,
    }).eq("id", activeDraftId);
    await db.from("campaign_leads").update({
      draft_id: activeDraftId,
      crm_status: "draft",
      updated_at: now,
    }).eq("id", target.id);
    return { ok: false, reason: (err as Error).message };
  }
}

/** Fetch campaign_leads eligible for draft generation (batch). */
export async function fetchDraftTargets(
  db: SupabaseClient,
  campaignId: string,
  limit = 10,
  stepNumber = 1,
): Promise<CampaignLeadTarget[]> {
  const { data: generatingDrafts } = await db
    .from("email_drafts")
    .select("lead_id")
    .eq("campaign_id", campaignId)
    .eq("status", "generating");

  const generatingLeadIds = new Set((generatingDrafts ?? []).map((d) => d.lead_id));

  const { data: rows } = await db
    .from("campaign_leads")
    .select(`
      id, lead_id,
      attachment_path, attachment_name, attachment_mime, attachment_size, attachment_url,
      leads!inner(
        id, first_name, last_name, email, title, headline, seniority, country,
        organizations(name, domain, company_description, sells_to, keywords)
      )
    `)
    .eq("campaign_id", campaignId)
    .is("draft_id", null)
    .in("crm_status", ["new", "enriched", "draft"])
    .not("leads.email", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit * 2);

  return (rows ?? [])
    .filter((r) => !generatingLeadIds.has(r.lead_id))
    .slice(0, limit) as CampaignLeadTarget[];
}

/** Count leads still pending draft generation. */
export async function countPendingDrafts(db: SupabaseClient, campaignId: string): Promise<number> {
  const { count } = await db
    .from("campaign_leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .is("draft_id", null)
    .in("crm_status", ["new", "enriched", "draft"]);

  const { count: generatingCount } = await db
    .from("email_drafts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "generating");

  return (count ?? 0) + (generatingCount ?? 0);
}
