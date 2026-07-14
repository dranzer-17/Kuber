import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { complete } from "@/lib/services/llm";
import { resolveCampaignSignature, resolveReplyPrompt, getProductOfferings, getCompanyContext } from "@/lib/services/settings";
import { appendSignatureToBody } from "@/lib/reply-body-html";
import { listThreadEmails, type InstantlyEmail } from "@/lib/services/instantly";

const ReplySchema = z.object({ subject: z.string(), body: z.string() });

// Appended in code so these hold regardless of the editable settings prompt.
const REPLY_GUARDRAILS = `

NON-NEGOTIABLE REPLY RULES (override anything above if in conflict):
1. Read the prospect's latest message carefully and respond to its actual content point by point — answer their questions, acknowledge specifics they mentioned (quantities, products, timelines, meeting requests). Never send a generic acknowledgement.
2. Always move the conversation forward with ONE concrete next step (e.g. propose two specific time slots for a call, ask for their required grade/quantity, offer to send samples).
3. Match the prospect's tone and keep it concise — 3 to 6 sentences unless the prospect asked detailed technical questions.
4. NEVER claim a file, brochure, price list, or document is attached. You cannot attach files. If sharing a document is warranted, say you will share it or offer to send it, without claiming it is attached.
5. Use the product reference library to answer product questions accurately; do not invent specifications, prices, or discounts unless they appear in the campaign context.
6. No exclamation marks, no em dashes, British English, no placeholders, no sign-off or signature (appended automatically).`;

interface GenerateReplyArgs {
  replyDraftId: string;
  masterCampaignId: string | null;
  campaignName: string;
  replyText: string;
  replySubject: string | null;
  originalEmailText: string | null;
  threadId?: string | null;
  aiPromptContext?: string | null;
  customInstruction?: string;
}

export async function generateReplyDraft(
  db: SupabaseClient,
  args: GenerateReplyArgs,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    // Optional: pull full thread for context (mind the 20/min cap; one call per reply is fine)
    let threadContext = "";
    if (args.threadId) {
      try {
        const emails: InstantlyEmail[] = await listThreadEmails(args.threadId);
        threadContext = emails
          .map((e) => {
            const who = e.ue_type === 2 ? "PROSPECT" : "US";
            const txt = (e.body?.text ?? "").trim();
            return txt ? `--- ${who} ---\n${txt}` : "";
          })
          .filter(Boolean)
          .join("\n\n");
      } catch { /* fall back to just the reply + original */ }
    }
    if (!threadContext) {
      threadContext = [
        `--- US (cold email) ---`, args.originalEmailText ?? "(not available)",
        ``, `--- PROSPECT (reply) ---`, args.replyText,
      ].join("\n");
    }

    // Resolve campaign owner (their prompt + signature) and additional AI
    // context from the master campaign. Replies speak with the same voice as
    // the cold email that started the thread (planning.md D1).
    let signatureBlock = "";
    let aiPromptContext = args.aiPromptContext?.trim() || null;
    let campaignName = args.campaignName;
    let campaignOwnerId: string | null = null;
    if (args.masterCampaignId) {
      const { data: campaign } = await db
        .from("campaigns")
        .select("name, signature_override, created_by, ai_prompt_context")
        .eq("id", args.masterCampaignId)
        .maybeSingle();
      if (campaign) {
        campaignOwnerId = campaign.created_by ?? null;
        if (!aiPromptContext && campaign.ai_prompt_context?.trim()) {
          aiPromptContext = campaign.ai_prompt_context.trim();
        }
        if (campaign.name) campaignName = campaign.name;
        signatureBlock = await resolveCampaignSignature(db, campaign).catch(() => "");
      }
    }

    const [drafter, products, companyContext] = await Promise.all([
      resolveReplyPrompt(db, campaignOwnerId),
      getProductOfferings(db),
      getCompanyContext(db),
    ]);
    const productBlock = products.length > 0
      ? "\n\nPRODUCT REFERENCE LIBRARY:\n\n" + products.map((p) => `${p.name.toUpperCase()}\n${p.description}`).join("\n\n")
      : "";
    const system = drafter
      + (companyContext ? `\n\nCompany context: ${companyContext}` : "")
      + productBlock
      + (aiPromptContext ? `\n\nAdditional campaign context:\n${aiPromptContext}` : "")
      + REPLY_GUARDRAILS;

    const user = [
      `Campaign: "${campaignName}"`,
      `Original reply subject: ${args.replySubject ?? "(none)"}`,
      ``,
      `Full conversation so far (oldest first):`,
      threadContext,
      aiPromptContext ? `Campaign context: ${aiPromptContext}` : "",
      args.customInstruction ? `Additional instruction: ${args.customInstruction}` : "",
    ].filter(Boolean).join("\n");

    const { json } = await complete<{ subject: string; body: string }>({ system, user });
    const parsed = ReplySchema.safeParse(json);
    if (!parsed.success) throw new Error("Reply shape mismatch");

    let body = parsed.data.body.trim()
      .replace(/\[Your Name\]/gi, "")
      .replace(/\n+\s*(best regards|regards|sincerely|thanks|thank you|cheers)[.,]?\s*$/i, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (signatureBlock) {
      body = appendSignatureToBody(body, signatureBlock);
    }

    await db.from("reply_drafts").update({
      subject: parsed.data.subject,
      body,
      status: "draft",
      updated_at: new Date().toISOString(),
    }).eq("id", args.replyDraftId);

    return { ok: true };
  } catch (err) {
    await db.from("reply_drafts").update({
      status: "failed",
      error: (err as Error).message,
      updated_at: new Date().toISOString(),
    }).eq("id", args.replyDraftId);
    return { ok: false, reason: (err as Error).message };
  }
}
