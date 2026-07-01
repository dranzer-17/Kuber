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
  body: z.string(),
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

// Converts assembled plain-text body (with **bold** markers and \n newlines) to HTML
// so the DB stores a renderable email and Instantly sends proper bold formatting.
function plainToHtml(plain: string): string {
  const escaped = plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return (
    "<p>" +
    escaped
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n{2,}/g, "<br><br>")
      .replace(/\n/g, "<br>") +
    "</p>"
  );
}
function buildTemplateInstruction(
  emailTemplate: Awaited<ReturnType<typeof getEmailTemplate>>,
  productSections: Awaited<ReturnType<typeof getProductSections>>,
  hasAttachment: boolean,
): string {
  const closing = hasAttachment ? emailTemplate.closingWithAttachment : emailTemplate.closingNoAttachment;
  return [
    "\n\nEMAIL BODY STRUCTURE — write all five sections in order as one cohesive body:",
    "1. PERSONALISED OPENING (2-4 sentences): Address the lead specifically. Reference what their company does and bridge naturally to Kuber's relevance. Do NOT restate Kuber's credentials here — that comes next.",
    "2. COMPANY INTRODUCTION — include this text verbatim (or very close):\n" + emailTemplate.intro,
    "3. OFFERINGS & KEY STRENGTHS — include this text verbatim (or very close):\n" + emailTemplate.offerings,
    "4. PRODUCT RECOMMENDATION (1 short paragraph, naturally written — do NOT copy-paste verbatim): Highlight 2-3 specific benefits from the matched product that are most relevant to this lead's business.",
    "5. CLOSING — include this text verbatim:\n" + closing,
    "",
    "PRODUCT REFERENCE LIBRARY — pick ONE and use it to write section 4:",
    `BLACK MASTERBATCH (fits: ${productSections.black.hint})\n${productSections.black.section}`,
    `WHITE MASTERBATCH (fits: ${productSections.white.hint})\n${productSections.white.section}`,
    `COLOUR MASTERBATCH (fits: ${productSections.color.hint})\n${productSections.color.section}`,
    `ADDITIVE MASTERBATCH (fits: ${productSections.additive.hint})\n${productSections.additive.section}`,
  ].join("\n\n");
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
    // Assemble full system prompt with campaign context + template/product context
    const systemPrompt =
      baseSystemPrompt
      + (aiPromptContext ? `\n\nAdditional campaign context:\n${aiPromptContext}` : "")
      + buildTemplateInstruction(emailTemplate, productSections, !!effectiveAttachmentName);

    const { json } = await complete<DraftLLMOutput>({
      system: systemPrompt,
      user: buildUserPrompt(lead, campaignName, customInstruction, aiPromptContext, stepNumber),
    });

    const validated = DraftSchema.safeParse(json);
    if (!validated.success) throw new Error("Draft shape mismatch");

    // Strip any greeting/sign-off the LLM emitted despite instructions
    const aiBody = validated.data.body
      .trim()
      .replace(/\[Your Name\]/gi, "")
      .replace(/\[Your (Title|Position)\]/gi, "")
      .replace(/\[Your Contact Information\]/gi, "")
      .replace(/\[Your Company\]/gi, "")
      .replace(/^dear[^,\n]*,?\s*/i, "")
      .replace(/\n+\s*(best regards|regards|sincerely|warm regards|thanks|thank you|cheers)[.,]?\s*$/i, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const greetingName = lead.first_name?.trim();
    const greeting = greetingName ? `Dear ${greetingName},` : "Dear Sir/Ma'am,";

    const finalBody = plainToHtml([greeting, aiBody, signatureBlock].filter(Boolean).join("\n\n"));

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
