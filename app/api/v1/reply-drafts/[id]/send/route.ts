import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { sendThreadReply } from "@/lib/services/unibox";
import { assertReplyDraftAccess } from "@/lib/auth/scope";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;
  const db = createAdminClient();
  try { await assertReplyDraftAccess(db, user, id); } catch (r) { return r as Response; }

  const { data: rd } = await db.from("reply_drafts").select("*").eq("id", id).maybeSingle();
  if (!rd) return fail(404, "NOT_FOUND", "Reply draft not found");
  if (rd.status === "sent") return fail(409, "ALREADY_SENT", "This reply was already sent");
  if (!rd.reply_to_uuid || !rd.eaccount) {
    return fail(400, "MISSING_THREAD", "Missing reply_to_uuid or eaccount — cannot thread the reply");
  }
  if (!rd.subject || !rd.body) return fail(400, "EMPTY", "Reply subject/body is empty");

  try {
    const bodyHtml = rd.body.replace(/\n/g, "<br>");
    await sendThreadReply(db, {
      replyToUuid: rd.reply_to_uuid,
      eaccount: rd.eaccount,
      subject: rd.subject,
      bodyHtml,
      bodyText: rd.body,
      campaignLeadId: rd.campaign_lead_id,
      campaignId: rd.campaign_id,
      replyEventId: rd.reply_event_id,
      source: "campaign_replies",
      replyDraftId: rd.id,
    });
    return ok({ sent: true });
  } catch (err) {
    return fail(502, "INSTANTLY_ERROR", (err as Error).message);
  }
}
