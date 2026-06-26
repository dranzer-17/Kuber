import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { replyToInstantlyEmail } from "@/lib/services/instantly";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;
  const db = createAdminClient();

  const { data: rd } = await db.from("reply_drafts").select("*").eq("id", id).maybeSingle();
  if (!rd) return fail(404, "NOT_FOUND", "Reply draft not found");
  if (rd.status === "sent") return fail(409, "ALREADY_SENT", "This reply was already sent");
  if (!rd.reply_to_uuid || !rd.eaccount) {
    return fail(400, "MISSING_THREAD", "Missing reply_to_uuid or eaccount — cannot thread the reply");
  }
  if (!rd.subject || !rd.body) return fail(400, "EMPTY", "Reply subject/body is empty");

  try {
    const bodyHtml = rd.body.replace(/\n/g, "<br>");
    await replyToInstantlyEmail({
      replyToUuid: rd.reply_to_uuid,
      eaccount: rd.eaccount,
      subject: rd.subject,
      bodyHtml,
      bodyText: rd.body,
    });

    const now = new Date().toISOString();
    await db.from("reply_drafts").update({ status: "sent", sent_at: now, updated_at: now }).eq("id", id);

    if (rd.campaign_lead_id) {
      await db.from("campaign_leads").update({ updated_at: now }).eq("id", rd.campaign_lead_id);
    }
    return ok({ sent: true });
  } catch (err) {
    return fail(502, "INSTANTLY_ERROR", (err as Error).message);
  }
}
