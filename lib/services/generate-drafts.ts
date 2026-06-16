import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { complete, type DraftOutput } from "@/lib/services/llm";
import { getDraftSystemPrompt, resolveCampaignSignature } from "@/lib/services/settings";
import { KUBER_CONTEXT } from "@/lib/constants";

const DraftSchema = z.object({ subject: z.string(), body: z.string() });

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

// Approach A: instruct the LLM to NOT add a sign-off — we append it deterministically.
const SIGNATURE_INSTRUCTION =
  "\n\nIMPORTANT: Do NOT include any sign-off, signature, name, title, position, or " +
  "contact details at the end. End the email body with your final sentence only. " +
  "The signature is appended automatically by the system.";

function buildUserPrompt(lead: LeadRow, campaignName: string, customInstruction?: string, aiPromptContext?: string): string {
  const org = unwrapOrg(lead.organizations);
  const lines = [
    `Campaign: "${campaignName}"`,
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
    `Instruction: Write a complete email body. Do NOT use any bracketed placeholders like [Your Name].`,
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

  // Per-lead attachment overrides campaign default
  const effectiveAttachmentName = target.attachment_name ?? campaign?.attachment_name ?? null;

  const attachmentInstruction = effectiveAttachmentName
    ? `\n\nIMPORTANT: A file named "${effectiveAttachmentName}" is attached to this email. ` +
      `You MUST reference it naturally in ONE sentence near the end (before the closing line), ` +
      `e.g. "I've attached our company brochure for your reference." ` +
      `Do not invent details about the file beyond that it is attached.`
    : "";

  // --- Draft row (insert or reuse) ---
  let draftId = existingDraftId;

  if (!draftId) {
    const { data: draft, error: dErr } = await db
      .from("email_drafts")
      .insert({
        lead_id: lead.id,
        campaign_id: campaignId,
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
    const baseSystemPrompt = await getDraftSystemPrompt(db);
    // Assemble full system prompt with campaign context + attachment + signature instructions
    const systemPrompt =
      baseSystemPrompt
      + (aiPromptContext ? `\n\nAdditional campaign context:\n${aiPromptContext}` : "")
      + attachmentInstruction
      + SIGNATURE_INSTRUCTION;

    const { json } = await complete<DraftOutput>({
      system: systemPrompt,
      user: buildUserPrompt(lead, campaignName, customInstruction, aiPromptContext),
    });

    const validated = DraftSchema.safeParse(json);
    if (!validated.success) throw new Error("Draft shape mismatch");

    // Approach B safety net — remove any placeholder the LLM emitted anyway:
    let finalBody = validated.data.body.trim();
    finalBody = finalBody
      .replace(/\[Your Name\]/gi, "")
      .replace(/\[Your (Title|Position)\]/gi, "")
      .replace(/\[Your Contact Information\]/gi, "")
      .replace(/\[Your Company\]/gi, "")
      // Strip trailing sign-off the LLM adds despite SIGNATURE_INSTRUCTION
      .replace(/\n+\s*(best regards|regards|sincerely|warm regards|thanks|thank you|cheers)[.,]?\s*$/i, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Append the resolved signature:
    finalBody = `${finalBody}\n\n${signatureBlock}`;

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
