import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { getThreadMessages, sendThreadReply } from "@/lib/services/unibox";
import { assertCampaignAccess } from "@/lib/auth/scope";

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const body = await req.json().catch(() => null) as {
    thread_id?: string;
    subject?: string;
    body_html?: string;
    body_text?: string;
    cc?: string[];
    bcc?: string[];
    reply_draft_id?: string;
  } | null;

  if (!body?.thread_id || !body.subject || !body.body_html) {
    return fail(400, "VALIDATION_ERROR", "thread_id, subject, and body_html required");
  }

  const db = createAdminClient();
  const thread = await getThreadMessages(db, body.thread_id);
  const campaignId = (thread.campaign as { id?: string } | null)?.id;
  if (user.role === "employee") {
    if (!campaignId) return fail(404, "NOT_FOUND", "Thread not found");
    try { await assertCampaignAccess(db, user, campaignId); } catch (r) { return r as Response; }
  }
  if (!thread.reply_to_uuid || !thread.eaccount) {
    return fail(400, "MISSING_THREAD", "No received message to reply to in this thread");
  }

  const result = await sendThreadReply(db, {
    replyToUuid: thread.reply_to_uuid,
    eaccount: thread.eaccount,
    subject: body.subject,
    bodyHtml: body.body_html,
    bodyText: body.body_text,
    cc: body.cc,
    bcc: body.bcc,
    campaignLeadId: thread.campaign_lead_id,
    campaignId: (thread.campaign as { id?: string } | null)?.id ?? null,
    source: "unibox",
    replyDraftId: body.reply_draft_id,
  });

  return ok(result);
}
