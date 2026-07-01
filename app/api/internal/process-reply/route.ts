import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyReply, applyClassification } from "@/lib/services/classify-reply";
import { generateReplyDraft } from "@/lib/services/generate-reply";
import { getInstantlyEmail, listThreadEmails } from "@/lib/services/instantly";

export const maxDuration = 55;

export async function POST(req: NextRequest) {
  if (req.headers.get("x-internal-secret") !== process.env.INTERNAL_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const b = await req.json().catch(() => ({})) as {
    reply_event_id?: string;
    reply_text?: string;
    reply_subject?: string | null;
    email_id?: string | null;
    campaign_lead_id?: string | null;
    master_campaign_id?: string | null;
    lead_email?: string | null;
  };
  if (!b.reply_event_id || !b.reply_text) {
    return Response.json({ error: "reply_event_id and reply_text required" }, { status: 400 });
  }

  const db = createAdminClient();

  // Self-heal: mark reply drafts stuck in 'generating' for >5 minutes as failed
  try { await db.rpc("reset_stuck_reply_drafts", { stale_minutes: 5 }); } catch { /* non-fatal */ }

  // --- gather context: our original email + thread + eaccount (best-effort) ---
  let originalEmailText: string | null = null;
  let threadId: string | null = null;
  let eaccount: string | null = null;
  if (b.email_id) {
    try {
      const inbound = await getInstantlyEmail(b.email_id);
      threadId = inbound.thread_id ?? null;
      eaccount = inbound.eaccount ?? null;

      // Pull the thread and find our first outbound email as originalEmailText
      // so the classifier and drafter have the full context they need.
      if (threadId) {
        const threadEmails = await listThreadEmails(threadId);
        // ue_type 2 = received (prospect). Everything else is us. Take the earliest non-received email.
        const ourFirst = threadEmails.find((e) => e.ue_type !== 2);
        if (ourFirst?.body?.text) {
          originalEmailText = ourFirst.body.text.trim() || null;
        }
      }
    } catch { /* non-fatal — classifier has safe defaults */ }
  }

  // resolve campaign name + ai context
  let campaignName = "Campaign";
  let aiPromptContext: string | null = null;
  if (b.master_campaign_id) {
    const { data: c } = await db
      .from("campaigns")
      .select("name, ai_prompt_context")
      .eq("id", b.master_campaign_id)
      .maybeSingle();
    if (c) { campaignName = c.name; aiPromptContext = c.ai_prompt_context ?? null; }
  }

  // --- 1) classify ---
  const classification = await classifyReply(db, {
    originalEmailText,
    replyText: b.reply_text,
  });
  await applyClassification(db, {
    campaignLeadId: b.campaign_lead_id ?? null,
    masterCampaignId: b.master_campaign_id ?? null,
    leadEmail: b.lead_email ?? null,
    classification,
    replyEventId: b.reply_event_id,
  });

  // --- 2) do NOT draft a reply for unsubscribes ---
  if (classification.temperature === "unsubscribed") {
    return Response.json({ classified: classification.temperature, drafted: false });
  }

  // --- 3) create a reply_draft row + generate ---
  const { data: rd, error } = await db
    .from("reply_drafts")
    .insert({
      reply_event_id: b.reply_event_id,
      campaign_lead_id: b.campaign_lead_id ?? null,
      campaign_id: b.master_campaign_id ?? null,
      status: "generating",
      reply_to_uuid: b.email_id ?? null,
      eaccount,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !rd) {
    return Response.json({ classified: classification.temperature, drafted: false, error: error?.message });
  }

  const result = await generateReplyDraft(db, {
    replyDraftId: rd.id,
    masterCampaignId: b.master_campaign_id ?? null,
    campaignName,
    replyText: b.reply_text,
    replySubject: b.reply_subject ?? null,
    originalEmailText,
    threadId,
    aiPromptContext,
  });

  return Response.json({
    classified: classification.temperature,
    drafted: result.ok,
    reply_draft_id: rd.id,
  });
}
