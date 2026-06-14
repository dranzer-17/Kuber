import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { createInstantlyCampaign, addLeadsToInstantly, activateInstantlyCampaign } from "@/lib/services/instantly";
import { getClientContext } from "@/lib/services/settings";
import { z } from "zod";

const Schema = z.object({
  lead_ids: z.array(z.string().uuid()).optional(),
});

const DEFAULT_SEND_DAYS = {
  monday: true, tuesday: true, wednesday: true,
  thursday: true, friday: true, saturday: false, sunday: false,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();
  const { data: campaign } = await db
    .from("campaigns")
    .select("name, human_in_loop, instantly_campaign_id, daily_limit, window_from, window_to, schedule_timezone, send_days, sender_name, sent_count")
    .eq("id", id)
    .single();

  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");

  const clientCtx = await getClientContext(db);
  const senderName = campaign.sender_name?.trim() || clientCtx.defaultSenderName;

  let q = db
    .from("campaign_leads")
    .select(`
      id, lead_id, draft_id,
      leads(id, first_name, last_name, email),
      email_drafts!inner(id, subject, body, status)
    `)
    .eq("campaign_id", id)
    .eq("crm_status", "approved")
    .eq("email_drafts.status", "approved");

  if (parsed.data.lead_ids?.length) {
    q = q.in("lead_id", parsed.data.lead_ids);
  }

  const { data: rows, error } = await q;
  if (error) return fail(500, "INTERNAL", error.message);

  if (!rows?.length) {
    return fail(400, "NO_APPROVED", "No certified leads to send. Certify drafts first.");
  }

  if (parsed.data.lead_ids?.length) {
    const foundIds = new Set(rows.map((r) => r.lead_id));
    const notCertified = parsed.data.lead_ids.filter((lid) => !foundIds.has(lid));
    if (notCertified.length > 0) {
      return fail(400, "NOT_CERTIFIED", "Some leads are not certified", { lead_ids: notCertified });
    }
  }

  type LeadData = { id: string; first_name: string | null; last_name: string | null; email: string | null };
  type DraftData = { id: string; subject: string | null; body: string | null; status: string };

  const emails = rows.map((row) => {
    const lead = (Array.isArray(row.leads) ? row.leads[0] : row.leads) as LeadData | null;
    const draft = (Array.isArray(row.email_drafts) ? row.email_drafts[0] : row.email_drafts) as DraftData | null;
    return {
      campaignLeadId: row.id,
      draftId: draft!.id,
      email: lead!.email!,
      firstName: lead!.first_name ?? "",
      lastName: lead!.last_name ?? "",
      subject: draft!.subject!,
      body: draft!.body!,
    };
  });

  const sendDays = (campaign.send_days as Record<string, boolean> | null) ?? DEFAULT_SEND_DAYS;

  try {
    let instantlyId = campaign.instantly_campaign_id;

    if (!instantlyId) {
      instantlyId = await createInstantlyCampaign(campaign.name, {
        dailyLimit: campaign.daily_limit ?? 30,
        windowFrom: campaign.window_from ?? "08:00",
        windowTo: campaign.window_to ?? "18:00",
        timezone: campaign.schedule_timezone ?? "Asia/Kolkata",
        sendDays,
      });
    }

    await addLeadsToInstantly(instantlyId, emails.map((e) => ({
      email: e.email,
      firstName: e.firstName,
      lastName: e.lastName,
      subject: e.subject,
      body: e.body,
      senderName,
    })));

    if (!campaign.human_in_loop && !campaign.instantly_campaign_id) {
      await activateInstantlyCampaign(instantlyId);
    }

    const now = new Date().toISOString();
    const draftIds = emails.map((e) => e.draftId);
    const clIds = emails.map((e) => e.campaignLeadId);

    await db.from("email_drafts").update({
      status: "sent",
      updated_at: now,
    }).in("id", draftIds);

    await db.from("campaign_leads").update({
      crm_status: "sent",
      updated_at: now,
    }).in("id", clIds);

    await db.from("campaigns").update({
      instantly_campaign_id: instantlyId,
      status: campaign.human_in_loop ? "draft" : "active",
      sent_count: (campaign.sent_count ?? 0) + emails.length,
      updated_at: now,
    }).eq("id", id);

    return ok({
      instantly_campaign_id: instantlyId,
      sent_count: emails.length,
      activated: !campaign.human_in_loop && !campaign.instantly_campaign_id,
    });
  } catch (err) {
    return fail(500, "INSTANTLY_ERROR", (err as Error).message);
  }
}
