import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "crypto";

const CRM_BY_EVENT: Record<string, string | undefined> = {
  reply_received:    "replied",
  email_bounced:     "failed",
  lead_unsubscribed: "closed",
};

const INTEREST_BY_EVENT: Record<string, number | undefined> = {
  lead_interested:          1,
  lead_meeting_booked:      2,
  lead_meeting_completed:   3,
  lead_closed:              4,
  lead_out_of_office:       0,
  lead_not_interested:      -1,
  lead_wrong_person:        -2,
};

interface InstantlyWebhookPayload {
  event_type?: string;
  timestamp?: string;
  campaign_id?: string;    // Instantly's campaign UUID (our sub-campaign's instantly_campaign_id)
  campaign_name?: string;
  lead_email?: string;
  email_id?: string;       // reply_to_uuid — use to send reply via API
  step?: number;
  variant?: number;
  reply_text?: string;
  reply_html?: string;
  reply_text_snippet?: string;
  reply_subject?: string;
}

export async function POST(req: NextRequest) {
  // 1) Verify shared secret
  const secret = req.headers.get("x-webhook-secret");
  if (!process.env.INSTANTLY_WEBHOOK_SECRET || secret !== process.env.INSTANTLY_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const p = await req.json().catch(() => null) as InstantlyWebhookPayload | null;
  if (!p?.event_type) return NextResponse.json({ ok: true });

  const db = createAdminClient();
  const receivedAt = p.timestamp ?? new Date().toISOString();
  const replyBody = p.reply_text ?? p.reply_text_snippet ?? null;

  // 2) Idempotency key (sha256 of timestamp+email+event+email_id)
  const eventUid = createHash("sha256")
    .update(`${receivedAt}|${p.lead_email ?? ""}|${p.event_type}|${p.email_id ?? ""}`)
    .digest("hex");

  // 3) Resolve Instantly campaign UUID → our sub + master
  //    p.campaign_id here is Instantly's UUID (instantly_campaigns.instantly_campaign_id)
  let subId: string | null = null;
  let masterId: string | null = null;
  if (p.campaign_id) {
    const { data: sub } = await db
      .from("instantly_campaigns")
      .select("id,campaign_id")
      .eq("instantly_campaign_id", p.campaign_id)
      .maybeSingle();
    if (sub) { subId = sub.id; masterId = sub.campaign_id; }
  }

  // 4) Resolve campaign_lead via master + lead_email
  let campaignLeadId: string | null = null;
  if (masterId && p.lead_email) {
    const { data: lead } = await db
      .from("leads")
      .select("id")
      .eq("email", p.lead_email)
      .maybeSingle();
    if (lead) {
      const { data: cl } = await db
        .from("campaign_leads")
        .select("id")
        .eq("campaign_id", masterId)
        .eq("lead_id", lead.id)
        .maybeSingle();
      if (cl) campaignLeadId = cl.id;
    }
  }

  // 5) Append event (idempotent — never dropped even if unmapped)
  await db.from("reply_events").upsert(
    {
      event_uid:              eventUid,
      campaign_id:            masterId,
      instantly_campaign_id:  subId,
      campaign_lead_id:       campaignLeadId,
      event_type:             p.event_type,
      lead_email:             p.lead_email ?? null,
      email_id:               p.email_id ?? null,
      step:                   p.step ?? null,
      variant:                p.variant ?? null,
      reply_body:             replyBody,
      received_at:            receivedAt,
      created_at:             new Date().toISOString(),
    },
    { onConflict: "event_uid", ignoreDuplicates: true },
  );

  // 6) Update campaign_leads state
  if (campaignLeadId) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (CRM_BY_EVENT[p.event_type])                          patch.crm_status = CRM_BY_EVENT[p.event_type];
    if (INTEREST_BY_EVENT[p.event_type] !== undefined)       patch.interest_status = INTEREST_BY_EVENT[p.event_type];
    if (p.event_type === "reply_received") {
      patch.last_reply_at   = receivedAt;
      patch.last_reply_body = replyBody;
    }
    if (Object.keys(patch).length > 1) {
      await db.from("campaign_leads").update(patch).eq("id", campaignLeadId);
    }
  }

  // 7) Org-level hard opt-out: unsubscribe blocks the whole org
  if (p.event_type === "lead_unsubscribed" && p.lead_email) {
    const { data: lead } = await db
      .from("leads")
      .select("organization_id")
      .eq("email", p.lead_email)
      .maybeSingle();
    if (lead?.organization_id) {
      await db
        .from("organizations")
        .update({ unsubscribed: true })
        .eq("id", lead.organization_id);
    }
  }

  return NextResponse.json({ ok: true });
}
