import { z } from "zod";
import { complete } from "@/lib/services/llm";

const FollowUpRewriteSchema = z.object({
  body: z.string(),
});

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function plainToHtml(plain: string): string {
  const escaped = plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return "<p>" + escaped.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>") + "</p>";
}

/**
 * Isolated follow-up rewrite — deliberately independent of the step-1 draft
 * pipeline (generateOneDraft / buildUserPrompt). Uses ONLY the current
 * follow-up text and the user's instruction: no lead/org data, no Kuber
 * context, no product library, no shared base system prompt. A follow-up is
 * a short reply-style nudge, not a second cold pitch, and must never be
 * generated the same way as the original draft.
 */
export async function regenerateFollowUpText(opts: {
  leadFirstName: string | null;
  currentBody: string; // HTML
  instruction: string;
}): Promise<{ body: string }> {
  const system = [
    "You rewrite short cold-email follow-up nudges.",
    "Rules:",
    "- 2-4 short sentences, casual \"just checking in\" tone.",
    "- Do not reintroduce a company pitch, product list, or bullet points.",
    "- Do not write a subject line — follow-ups always thread as a reply.",
    "- Apply the user's instruction to the CURRENT follow-up text below; rewrite it, don't start over from scratch.",
    "Return strict JSON: {\"body\": \"...\"}",
  ].join("\n");

  const user = [
    `Recipient first name: ${opts.leadFirstName?.trim() || "there"}`,
    "",
    "Current follow-up email:",
    htmlToPlainText(opts.currentBody),
    "",
    `Instruction: ${opts.instruction}`,
  ].join("\n");

  const { json } = await complete<{ body: string }>({ system, user });
  const validated = FollowUpRewriteSchema.safeParse(json);
  if (!validated.success) throw new Error("Follow-up rewrite shape mismatch");

  return { body: plainToHtml(validated.data.body.trim()) };
}
