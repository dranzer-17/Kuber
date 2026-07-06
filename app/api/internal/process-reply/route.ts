import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateReplyDraft } from "@/lib/services/generate-reply";
import { getInstantlyEmail, listThreadEmails } from "@/lib/services/instantly";

export const maxDuration = 55;

/**
 * This route's ONLY job is generating our human-reviewed reply draft.
 * It does NOT classify the reply — lead_temperature / interest_status are set
 * exclusively by app/api/v1/webhooks/instantly/route.ts, driven by Instantly's own
 * built-in AI classification (lead_interested / lead_not_interested / etc. events).
 * This is a deliberate team decision: Instantly's classifier is the sole source of
 * truth for hot/cold/ooo/unsubscribed status. Do not re-add a classification step
 * here without confirming with the team first.
 */
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

  const { data: existing } = await db
    .from("reply_drafts")
    .select("id, status")
    .eq("reply_event_id", b.reply_event_id)
    .in("status", ["generating", "draft", "approved"])
    .maybeSingle();
  if (existing) {
    return Response.json({ drafted: true, reply_draft_id: existing.id, skipped: true });
  }

  // --- gather context: our original email + thread + eaccount (best-effort) ---
  let originalEmailText: string | null = null;
  let threadId: string | null = null;
  let eaccount: string | null = null;
  if (b.email_id) {
    try {
      const inbound = await getInstantlyEmail(b.email_id);
      threadId = inbound.thread_id ?? null;
      eaccount = inbound.eaccount ?? null;

      if (threadId) {
        const threadEmails = await listThreadEmails(threadId);
        // ue_type 2 = received (prospect). Everything else is us. Take the earliest non-received email.
        const ourFirst = threadEmails.find((e) => e.ue_type !== 2);
        if (ourFirst?.body?.text) {
          originalEmailText = ourFirst.body.text.trim() || null;
        }
      }
    } catch { /* non-fatal — drafter has safe defaults */ }
  }

  // resolve campaign name + ai context
  let campaignName = "Campaign";
  let aiPromptContext: string | null = null;
  let masterCampaignId = b.master_campaign_id ?? null;
  if (!masterCampaignId && b.campaign_lead_id) {
    const { data: cl } = await db
      .from("campaign_leads")
      .select("campaign_id")
      .eq("id", b.campaign_lead_id)
      .maybeSingle();
    masterCampaignId = cl?.campaign_id ?? null;
  }
  if (masterCampaignId) {
    const { data: c } = await db
      .from("campaigns")
      .select("name, ai_prompt_context")
      .eq("id", masterCampaignId)
      .maybeSingle();
    if (c) { campaignName = c.name; aiPromptContext = c.ai_prompt_context ?? null; }
  }

  // --- create a reply_draft row + generate (no classification step — see file header) ---
  const { data: rd, error } = await db
    .from("reply_drafts")
    .insert({
      reply_event_id: b.reply_event_id,
      campaign_lead_id: b.campaign_lead_id ?? null,
      campaign_id: masterCampaignId ?? null,
      status: "generating",
      reply_to_uuid: b.email_id ?? null,
      eaccount,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !rd) {
    return Response.json({ drafted: false, error: error?.message });
  }

  const result = await generateReplyDraft(db, {
    replyDraftId: rd.id,
    masterCampaignId: masterCampaignId,
    campaignName,
    replyText: b.reply_text,
    replySubject: b.reply_subject ?? null,
    originalEmailText,
    threadId,
    aiPromptContext,
  });

  return Response.json({
    drafted: result.ok,
    reply_draft_id: rd.id,
  });
}
