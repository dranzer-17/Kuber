import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { complete } from "@/lib/services/llm";
import { KUBER_CONTEXT } from "@/lib/constants";
import { resolveCampaignSignature, getReplyPrompts } from "@/lib/services/settings";
import { listThreadEmails, type InstantlyEmail } from "@/lib/services/instantly";

const ReplySchema = z.object({ subject: z.string(), body: z.string() });

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

    // Resolve campaign signature + additional AI context from the master campaign.
    let signatureBlock = "";
    let aiPromptContext = args.aiPromptContext?.trim() || null;
    let campaignName = args.campaignName;
    if (args.masterCampaignId) {
      const { data: campaign } = await db
        .from("campaigns")
        .select("name, signature_override, signature_user_id, created_by, ai_prompt_context")
        .eq("id", args.masterCampaignId)
        .maybeSingle();
      if (campaign) {
        if (!aiPromptContext && campaign.ai_prompt_context?.trim()) {
          aiPromptContext = campaign.ai_prompt_context.trim();
        }
        if (campaign.name) campaignName = campaign.name;
        signatureBlock = await resolveCampaignSignature(db, campaign).catch(() => "");
      }
    }

    const { drafter } = await getReplyPrompts(db);
    const system = drafter
      + `\n\nKuber context: ${KUBER_CONTEXT}`
      + (aiPromptContext ? `\n\nAdditional campaign context:\n${aiPromptContext}` : "");

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
    if (signatureBlock) body = `${body}\n\n${signatureBlock}`;

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
