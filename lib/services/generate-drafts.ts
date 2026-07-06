import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { complete } from "@/lib/services/llm";
import {
  getDraftSystemPrompt,
  getEmailSignature,
  getProductOfferings,
  getCompanyContext,
} from "@/lib/services/settings";

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
// Subject patterns rotated deterministically per lead so a batch of drafts
// never converges on the same one or two subjects.
const SUBJECT_PATTERNS = [
  "Greetings from Kuber Polyplast | Exploring Opportunities with [Company Name]",
  "Introduction: Kuber Polyplast | Masterbatch Solutions for [Industry]",
  "Kuber Polyplast | Connecting with [Company Name]",
  "Exploring Synergies: Kuber Polyplast and [Company Name]",
  "Kuber Polyplast | Masterbatch & Compounds for [Industry/Country] Manufacturers",
];

function pickSubjectPattern(leadId: string): string {
  let hash = 0;
  for (let i = 0; i < leadId.length; i++) hash = (hash * 31 + leadId.charCodeAt(i)) >>> 0;
  return SUBJECT_PATTERNS[hash % SUBJECT_PATTERNS.length];
}

// Hard guardrails appended in code so they apply regardless of what the
// editable settings prompt says.
const DRAFT_GUARDRAILS = `

NON-NEGOTIABLE RULES (override anything above if in conflict):
1. ATTACHMENTS: The lead data below states whether this email includes a brochure/file. If it says "No attachment", you must NOT write "Please find attached", "attached brochure", or reference any attachment or brochure anywhere. Rewrite the closing paragraph without the attachment sentence. Never claim a file is attached when none exists.
2. PERSONALISATION: The intro paragraph must reference at least one concrete, specific fact from the lead's company description, keywords, or end markets (e.g. what they manufacture, the products they sell, their market or country). Do not use vague filler such as "reliable materials for packaging, housings, and functional components" or "consistent material quality can be valuable for your operations". If the company clearly makes or packages physical products, name them. If it is a software/services company with no obvious plastics use, keep the intro honest: acknowledge what they do in one sentence, then bridge via their packaging, merchandise, or hardware suppliers rather than inventing a direct need.
3. PRODUCT MATCH: Weave the matched product's relevance into the intro naturally (e.g. white masterbatch for dairy packaging film) when the lead's industry plausibly uses it. Set product_match accordingly.
4. SUBJECT: Use exactly the subject pattern given in the lead data, filling the bracketed part with the lead's real company name, industry, or country. Do not use a different pattern.`;

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
    `Attachment: ${attachmentName ? `a brochure file "${attachmentName}" is included with this email (as a download link) — you may reference our brochure in the closing` : "No attachment — do NOT mention any attachment or brochure anywhere in the email"}`,
    `Subject pattern to use: ${pickSubjectPattern(lead.id)}`,
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
  // link embedded in the body — and if there is none, the LLM is told so and the
  // brochure sentence is stripped as a hard post-processing guarantee.
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
      + DRAFT_GUARDRAILS;

    const { json } = await complete<DraftLLMOutput>({
      system: systemPrompt,
      user: buildUserPrompt(lead, campaignName, companyContext, customInstruction, aiPromptContext, stepNumber, effectiveAttachmentName),
    });

    const validated = DraftSchema.safeParse(json);
    if (!validated.success) throw new Error("Draft shape mismatch");

    // Strip any greeting/sign-off the LLM emitted despite instructions
    let aiBody = validated.data.body
      .trim()
      .replace(/\[Your Name\]/gi, "")
      .replace(/\[Your (Title|Position)\]/gi, "")
      .replace(/\[Your Contact Information\]/gi, "")
      .replace(/\[Your Company\]/gi, "")
      .replace(/^dear[^,\n]*,?\s*/i, "")
      .replace(/\n+\s*(best regards|regards|sincerely|warm regards|thanks|thank you|cheers)[.,]?\s*$/i, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Hard guarantee: an email with no attachment must never claim one is attached,
    // even if the LLM ignores the instruction (the closing template historically
    // contained a fixed "Please find attached our brochure" sentence).
    if (!effectiveAttachmentName) {
      aiBody = aiBody
        .replace(/[^.\n]*\b(please find (the\s+)?attached|find attached|attached (our|the|is|you will find)|our attached)\b[^.\n]*\.\s*/gi, "")
        .replace(/[^.\n]*\bbrochure\b[^.\n]*\.\s*/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    const greetingName = lead.first_name?.trim();
    const greeting = greetingName ? `Dear ${greetingName},` : "Dear Sir/Ma'am,";

    let finalBody = plainToHtml([greeting, aiBody, signatureBlock].filter(Boolean).join("\n\n"));

    // Instantly cannot send real attachments, so deliver the brochure as a link:
    // linkify the first "brochure" mention; if the LLM never wrote one, append a
    // download line before the signature-free closing.
    if (effectiveAttachmentName && effectiveAttachmentUrl) {
      const anchor = `<a href="${effectiveAttachmentUrl}" target="_blank" rel="noopener">brochure</a>`;
      if (/brochure/i.test(finalBody)) {
        finalBody = finalBody.replace(/brochure/i, anchor);
        // "Please find attached our <a>brochure</a>" reads wrong for a link — soften the verb.
        finalBody = finalBody.replace(/Please find (the\s+)?attached our /i, "Please find our ");
      } else {
        finalBody = finalBody.replace(
          /<\/p>\s*$/,
          `<br><br>You can download our ${anchor} (${effectiveAttachmentName}) for further details.</p>`,
        );
      }
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
