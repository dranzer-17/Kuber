import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { complete } from "@/lib/services/llm";
import {
  getDraftSystemPrompt,
  getEmailSignature,
  getProductOfferings,
  getCompanyContext,
} from "@/lib/services/settings";

// The LLM writes the full email body from the Email Template system prompt
// (subject patterns, openings, offerings, closings, etc. live there as options).
// Code only adds greeting + signature and turns "brochure" into a download link.

const DraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  product_match: z.string(),
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
  attachment_path?: string | null;
  attachment_url?: string | null;
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

// Hard guardrails appended in code so they apply regardless of what the
// editable settings prompt says.
function buildDraftGuardrails(stepNumber: number): string {
  if (stepNumber > 1) {
    return `

NON-NEGOTIABLE RULES (override anything above if in conflict):
1. This is a FOLLOW-UP to a cold email the prospect never replied to. Your "body" field is the ENTIRE follow-up message (2 to 4 short sentences) — a brief, low-pressure nudge referencing the earlier note. Do NOT re-introduce Kuber Polyplast, do NOT repeat the offerings/strengths/accolades, do NOT use bullet points, do NOT write a new sales pitch.
2. ATTACHMENTS: never claim a file, brochure, or attachment is included unless the lead data explicitly says one is attached.
3. Keep it personal and specific to the lead's business if a fact is available, but brevity matters more than detail here.
4. NO FABRICATION: never state a price, discount, percentage, certification, technical spec, or delivery/lead-time claim unless it is explicitly present in the lead data, the PRODUCT REFERENCE LIBRARY, or the campaign context given below. If none is given, stay qualitative — do not invent a number to sound persuasive.
4b. CAMPAIGN CONTEXT: if a "Campaign context" line is given below, it is a directive from the sender, not optional trivia — you MUST work it into this follow-up nudge whenever it's relevant to the lead (e.g. a live promotion, seasonal offer, or specific message they want featured), not just permission to mention it if you feel like it.
5. FORMATTING: wrap at most one or two concrete facts (a product name, figure, or certification actually present in the data) in **double asterisks** so they render bold, matching the rest of the email. Do not bold whole sentences or generic phrases.
6. NO EM DASHES: never use an em dash (—) anywhere in your text. Split into two sentences, or use a comma or parentheses instead. Em dashes are one of the clearest tells of AI-generated writing.`;
  }
  return `

NON-NEGOTIABLE RULES (override anything above if in conflict):
1. Your "body" field is the FULL first-email body: opening line, personalised intro, company introduction, offerings, key strengths, accolades, and closing — following the structure and approved copy options in the system prompt. Do NOT invent figures, certifications, or claims outside those approved lists / the product library / lead data.
2. ATTACHMENTS: The lead data below states whether this email includes a brochure/file. If yes, use a closing that mentions "brochure" once. If no, do NOT mention any attachment or brochure.
3. PERSONALISATION: The personalised intro must reference at least one concrete, specific fact from the lead's company description, keywords, or end markets. Do not use vague filler. If the company clearly makes or packages physical products, name them. If it is a software/services company with no obvious plastics use, keep it honest: acknowledge what they do, then bridge via packaging, merchandise, or hardware suppliers rather than inventing a direct need.
4. PRODUCT MATCH: Weave the matched product's relevance into the intro naturally when the lead's industry plausibly uses it. Set product_match accordingly.
5. SUBJECT: Pick one approved subject pattern from the system prompt and fill the bracketed part with the lead's real company name, industry, or country. Do not invent a different pattern.
6. NO FABRICATION: never state a price, discount, percentage, certification, technical spec (e.g. TiO2 content, MFI, density), or delivery/lead-time claim unless it is explicitly present in the lead data, the PRODUCT REFERENCE LIBRARY, the approved copy in the system prompt, or the campaign context given below. Qualitative claims ("consistent opacity", "food-grade options") are fine; invented numbers are not.
6b. CAMPAIGN CONTEXT: if a "Campaign context" line is given below, it is a directive from the sender, not optional trivia — you MUST work it into the personalised intro whenever it's relevant to the lead.
7. FORMATTING: wrap at most one or two concrete facts actually present in the data in **double asterisks**. Do not bold whole sentences, generic phrases, or anything not grounded in the supplied data.
8. NO EM DASHES: never use an em dash (—) anywhere in your text. One idea per sentence; split with a period, or use a comma or parentheses instead.
9. Do NOT include a greeting ("Dear …") or signature/sign-off — those are added in code.`;
}

function buildProductReferenceBlock(products: Awaited<ReturnType<typeof getProductOfferings>>): string {
  if (products.length === 0) return "";
  const entries = products.map((p) => `${p.name.toUpperCase()}\n${p.description}`);
  return "\n\nPRODUCT REFERENCE LIBRARY — pick the ONE best fit for this lead and set product_match to its exact name:\n\n" + entries.join("\n\n");
}

function buildUserPrompt(
  lead: LeadRow,
  campaignName: string,
  companyContext: string,
  customInstruction?: string,
  aiPromptContext?: string,
  stepNumber = 1,
  attachmentName?: string | null,
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
    `Attachment: ${attachmentName ? `a brochure file "${attachmentName}" is included with this email — mention "brochure" once in the closing` : "No attachment — do NOT mention any attachment or brochure anywhere in the body"}`,
  ];
  if (companyContext) lines.push(`Company context: ${companyContext}`);
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

  // --- Fetch full campaign for attachment resolution ---
  const { data: campaign } = await db
    .from("campaigns")
    .select("id, signature_override, attachment_name, attachment_path, attachment_url, ai_prompt_context")
    .eq("id", campaignId)
    .maybeSingle();

  // Signature: campaign-level override wins; otherwise use the Email Footer setting.
  const emailFooter = await getEmailSignature(db);
  const signatureBlock = campaign?.signature_override?.trim() || emailFooter;

  // Per-lead attachment overrides campaign default. Instantly's API cannot send
  // real file attachments, so an "attachment" is delivered as a hosted download
  // link embedded in the body — and if there is none, the LLM is told so.
  const effectiveAttachmentName = target.attachment_name ?? campaign?.attachment_name ?? null;
  const effectiveAttachmentPath =
    (target.attachment_name ? target.attachment_path : campaign?.attachment_path) ?? null;
  let effectiveAttachmentUrl =
    (target.attachment_name ? target.attachment_url : campaign?.attachment_url) ?? null;
  if (effectiveAttachmentPath) {
    // Regenerate a long-lived signed URL — the one stored at upload time expires in 7 days.
    const { data: signed } = await db.storage
      .from("campaign-attachments")
      .createSignedUrl(effectiveAttachmentPath, 60 * 60 * 24 * 365);
    if (signed?.signedUrl) effectiveAttachmentUrl = signed.signedUrl;
  }

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
    const [baseSystemPrompt, products, companyContext] = await Promise.all([
      getDraftSystemPrompt(db),
      getProductOfferings(db),
      getCompanyContext(db),
    ]);
    const systemPrompt =
      baseSystemPrompt
      + (aiPromptContext ? `\n\nAdditional campaign context:\n${aiPromptContext}` : "")
      + buildProductReferenceBlock(products)
      + buildDraftGuardrails(stepNumber);

    const { json } = await complete<DraftLLMOutput>({
      system: systemPrompt,
      user: buildUserPrompt(lead, campaignName, companyContext, customInstruction, aiPromptContext, stepNumber, effectiveAttachmentName),
    });

    const validated = DraftSchema.safeParse(json);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      console.error("Draft schema validation failed for lead", lead.id, issues, json);
      throw new Error(`Draft shape mismatch — ${issues}`);
    }

    // Strip any greeting/sign-off/placeholder the LLM emitted despite instructions,
    // and — defense in depth — any attachment/brochure mention on follow-ups or when
    // no attachment is present.
    let aiBody = validated.data.body
      .trim()
      .replace(/\[Your Name\]/gi, "")
      .replace(/\[Your (Title|Position)\]/gi, "")
      .replace(/\[Your Contact Information\]/gi, "")
      .replace(/\[Your Company\]/gi, "")
      .replace(/^dear[^,\n]*,?\s*/i, "")
      .replace(/\n+\s*(best regards|regards|sincerely|warm regards|thanks|thank you|cheers)[.,]?\s*$/i, "")
      // Em dashes are a well-known AI-writing tell; the guardrails forbid them,
      // but strip any that slip through as a safety net rather than trust compliance.
      .replace(/\s*[—–]\s*/g, ", ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (stepNumber > 1 || !effectiveAttachmentName) {
      aiBody = aiBody.replace(
        /[^.\n]*\b(please find (the\s+)?attached|find attached|attached (our|the|is|you will find)|our attached|brochure)\b[^.\n]*\.\s*/gi,
        "",
      ).replace(/\n{3,}/g, "\n\n").trim();
    }

    const greetingName = lead.first_name?.trim();
    const greeting = greetingName ? `Dear ${greetingName},` : "Dear Sir/Ma'am,";

    let finalBody = plainToHtml([greeting, aiBody, signatureBlock].filter(Boolean).join("\n\n"));

    // Instantly cannot send real attachments, so deliver the brochure as a link.
    if (stepNumber === 1 && effectiveAttachmentName && effectiveAttachmentUrl) {
      const anchor = `<a href="${effectiveAttachmentUrl}" target="_blank" rel="noopener">brochure</a>`;
      finalBody = finalBody.replace(/brochure/i, anchor);
    }

    // Follow-ups must thread as a reply in the original conversation, which
    // Instantly does by leaving the subject empty — a hard rule, not left to
    // the LLM's judgment (it will invent one anyway if not forced here).
    const finalSubject = stepNumber > 1 ? "" : validated.data.subject;

    const finalStatus = humanInLoop ? "draft" : "approved";
    const now = new Date().toISOString();

    await db.from("email_drafts").update({
      subject: finalSubject,
      body: finalBody,
      status: finalStatus,
      ...(finalStatus === "approved" ? { approved_at: now, reviewed_by: userId ?? null } : {}),
      updated_at: now,
    }).eq("id", activeDraftId);

    // Only step 1 drives the lead's primary crm_status/draft_id — that's the
    // pipeline the sidebar badge, "Certify all", and "draft-ready" counts read.
    // A follow-up (step > 1) is generated for a lead whose step-1 email is
    // already sent; it must not flip that lead back to looking like "draft"
    // everywhere. Follow-up drafts live entirely in their own mini-panel,
    // queried directly by step_number (see /drafts/[id]/siblings).
    if (stepNumber === 1) {
      await db.from("campaign_leads").update({
        draft_id: activeDraftId,
        crm_status: finalStatus === "approved" ? "approved" : "draft",
        updated_at: now,
      }).eq("id", target.id);
    }

    return { ok: true, draftId: activeDraftId, status: finalStatus };
  } catch (err) {
    const now = new Date().toISOString();
    await db.from("email_drafts").update({
      status: "failed",
      updated_at: now,
    }).eq("id", activeDraftId);
    if (stepNumber === 1) {
      await db.from("campaign_leads").update({
        draft_id: activeDraftId,
        crm_status: "draft",
        updated_at: now,
      }).eq("id", target.id);
    }
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

  if (stepNumber === 1) {
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

  // For follow-up steps: find approved/sent leads that don't yet have a draft for this step.
  const { data: existingStepDrafts } = await db
    .from("email_drafts")
    .select("lead_id")
    .eq("campaign_id", campaignId)
    .eq("step_number", stepNumber);

  const alreadyHasStep = new Set((existingStepDrafts ?? []).map((d) => d.lead_id));

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
    .in("crm_status", ["approved", "sent"])
    .not("leads.email", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit * 2);

  return (rows ?? [])
    .filter((r) => !generatingLeadIds.has(r.lead_id) && !alreadyHasStep.has(r.lead_id))
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
