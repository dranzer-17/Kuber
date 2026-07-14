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

  // Atomic claim (planning.md Phase 6.3): flip draft/approved → sending in one
  // guarded UPDATE. Two rapid clicks race on this row — exactly one gets it;
  // the other sees zero rows and 409s, so the customer can never receive the
  // reply twice. The approval gate is built into the WHERE (rejected/failed/
  // generating rows never match).
  const { data: claimed } = await db
    .from("reply_drafts")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["draft", "approved"])
    .select("*")
    .maybeSingle();

  if (!claimed) {
    const { data: rd } = await db.from("reply_drafts").select("status").eq("id", id).maybeSingle();
    if (!rd) return fail(404, "NOT_FOUND", "Reply draft not found");
    if (rd.status === "sent" || rd.status === "sending") {
      return fail(409, "ALREADY_SENT", "This reply was already sent");
    }
    return fail(409, "NOT_SENDABLE", `A reply in status '${rd.status}' cannot be sent`);
  }

  const previousStatus = "draft"; // safe rollback target: still requires review before re-send

  async function release(error?: string) {
    await db.from("reply_drafts")
      .update({ status: previousStatus, ...(error ? { error: error.slice(0, 500) } : {}), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "sending");
  }

  if (!claimed.reply_to_uuid || !claimed.eaccount) {
    await release();
    return fail(400, "MISSING_THREAD", "Missing reply_to_uuid or eaccount — cannot thread the reply");
  }
  if (!claimed.subject || !claimed.body) {
    await release();
    return fail(400, "EMPTY", "Reply subject/body is empty");
  }

  try {
    const bodyHtml = claimed.body.replace(/\n/g, "<br>");
    await sendThreadReply(db, {
      replyToUuid: claimed.reply_to_uuid,
      eaccount: claimed.eaccount,
      subject: claimed.subject,
      bodyHtml,
      bodyText: claimed.body,
      campaignLeadId: claimed.campaign_lead_id,
      campaignId: claimed.campaign_id,
      replyEventId: claimed.reply_event_id,
      source: "campaign_replies",
      replyDraftId: claimed.id,
    });
    return ok({ sent: true });
  } catch (err) {
    await release((err as Error).message);
    return fail(502, "INSTANTLY_ERROR", (err as Error).message);
  }
}
