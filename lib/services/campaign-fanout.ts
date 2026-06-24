import { createAdminClient } from "@/lib/supabase/admin";
import { COUNTRY_TO_TIMEZONE } from "@/lib/constants";
import {
  createInstantlyCampaign,
  addLeadsToInstantly,
  activateInstantlyCampaign,
  buildCustomVariables,
  type InstantlyStep,
  type InstantlyLeadInput,
} from "@/lib/services/instantly";

const BATCH = 100;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Country → timezone resolution ───────────────────────────────────────────
// Uses the COUNTRY_TO_TIMEZONE map already in lib/constants.ts.
// Falls back to the modal lead's own time_zone (Apollo-provided), then the master fallback.

function resolveCountryCode(countryName: string | null): string {
  // Simple ISO-2 map for bucketing (just the key, not the full timezone map)
  const MAP: Record<string, string> = {
    "india": "IN", "bangladesh": "BD", "pakistan": "PK", "sri lanka": "LK",
    "nepal": "NP", "united states": "US", "usa": "US",
    "united kingdom": "UK", "uk": "UK",
    "germany": "DE", "france": "FR", "poland": "PL",
    "united arab emirates": "AE", "uae": "AE",
    "turkey": "TR", "saudi arabia": "SA", "vietnam": "VN",
    "thailand": "TH", "indonesia": "ID", "malaysia": "MY",
    "china": "CN", "brazil": "BR", "mexico": "MX",
    "egypt": "EG", "nigeria": "NG", "kenya": "KE",
    "south africa": "ZA", "australia": "AU", "canada": "CA",
  };
  const key = (countryName ?? "").trim().toLowerCase();
  return MAP[key] ?? "XX";
}

function pickTimezone(
  leadTimezones: Array<string | null>,
  countryName: string | null,
  masterFallback: string,
): string {
  // 1. modal from Apollo-provided lead.time_zone values for this bucket
  const counts = new Map<string, number>();
  for (const tz of leadTimezones) {
    if (tz) counts.set(tz, (counts.get(tz) ?? 0) + 1);
  }
  if (counts.size > 0) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  // 2. country default from constants
  if (countryName) {
    const tz = COUNTRY_TO_TIMEZONE[countryName];
    if (tz) return tz;
  }
  // 3. master fallback
  return masterFallback;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function sendCampaign(
  campaignId: string,
  _actorId: string,
): Promise<{ buckets: number; sent: number }> {
  const db = createAdminClient();

  // 1) Fetch master campaign
  const { data: campaign, error: cErr } = await db
    .from("campaigns")
    .select("id,name,human_in_loop,window_from,window_to,send_days,schedule_timezone,daily_limit,sender_name,sent_count")
    .eq("id", campaignId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!campaign) throw new Error("Campaign not found");

  const fallbackTz = campaign.schedule_timezone ?? "Asia/Kolkata";
  const sendDays = (campaign.send_days as Record<string, boolean>) ?? {};

  // 2) Fetch sequence steps
  const { data: stepRows } = await db
    .from("campaign_steps")
    .select("step_order,delay,delay_unit,subject,body")
    .eq("campaign_id", campaignId)
    .order("step_order");
  const steps: InstantlyStep[] = (stepRows ?? []).map((s) => ({
    subject: s.subject ?? "",
    body: s.body ?? "",
    delay: s.delay ?? 0,
    delayUnit: (s.delay_unit ?? "days") as InstantlyStep["delayUnit"],
  }));
  if (steps.length === 0) throw new Error("Campaign has no steps — cannot send");

  // 3) Sending accounts from env
  const emailList = (process.env.INSTANTLY_SENDING_ACCOUNTS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (emailList.length === 0) {
    throw new Error(
      "INSTANTLY_SENDING_ACCOUNTS env var is empty — set comma-separated sender emails"
    );
  }

  // 4) Approved leads not yet pushed
  const { data: cls } = await db
    .from("campaign_leads")
    .select(`
      id, lead_id,
      leads:lead_id ( email, first_name, last_name, country, time_zone )
    `)
    .eq("campaign_id", campaignId)
    .in("crm_status", ["approved", "draft_ready"])
    .is("instantly_campaign_id", null);

  if (!cls || cls.length === 0) return { buckets: 0, sent: 0 };

  const leadIds = cls.map((r) => r.lead_id);

  // 5) Active drafts for all leads (all steps) — highest version wins per (lead, step)
  const { data: allDrafts } = await db
    .from("email_drafts")
    .select("lead_id,step_number,subject,body,version")
    .eq("campaign_id", campaignId)
    .in("lead_id", leadIds)
    .in("status", ["approved", "draft_ready"]);

  // Build map: leadId → Array<{step_number, subject, body}> (deduped, highest version first)
  const draftMap = new Map<string, Map<number, { subject: string | null; body: string | null }>>();
  for (const d of ((allDrafts ?? []).sort((a, b) => (b.version ?? 0) - (a.version ?? 0)))) {
    if (!draftMap.has(d.lead_id)) draftMap.set(d.lead_id, new Map());
    const byStep = draftMap.get(d.lead_id)!;
    if (!byStep.has(d.step_number)) byStep.set(d.step_number, { subject: d.subject, body: d.body });
  }
  const draftsForLead = (leadId: string) =>
    [...(draftMap.get(leadId) ?? new Map()).entries()].map(([step_number, v]) => ({ step_number, ...v }));

  // 6) Bucket leads by country
  type ClRow = (typeof cls)[number];
  const buckets = new Map<string, {
    code: string; countryName: string | null; rows: ClRow[];
  }>();
  for (const r of cls) {
    const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
    const countryName = lead?.country ?? null;
    const code = resolveCountryCode(countryName);
    if (!buckets.has(code)) buckets.set(code, { code, countryName, rows: [] });
    buckets.get(code)!.rows.push(r);
  }

  let totalSent = 0;

  // 7) Per bucket: find/create sub-campaign → push leads → activate
  for (const b of buckets.values()) {
    const tz = pickTimezone(
      b.rows.map((r) => {
        const l = Array.isArray(r.leads) ? r.leads[0] : r.leads;
        return l?.time_zone ?? null;
      }),
      b.countryName,
      fallbackTz,
    );

    const bucketLabel = b.countryName ?? "Other";

    // 7a) Upsert instantly_campaigns row
    let { data: sub } = await db
      .from("instantly_campaigns")
      .select("id,instantly_campaign_id")
      .eq("campaign_id", campaignId)
      .eq("country_code", b.code)
      .maybeSingle();

    if (!sub) {
      const { data: created, error } = await db
        .from("instantly_campaigns")
        .insert({
          campaign_id: campaignId,
          country: bucketLabel,
          country_code: b.code,
          timezone: tz,
          status: "creating",
          daily_limit: campaign.daily_limit ?? 30,
          email_list: emailList,
          created_at: new Date().toISOString(),
        })
        .select("id,instantly_campaign_id")
        .single();
      if (error) throw new Error(`instantly_campaigns insert: ${error.message}`);
      sub = created;
    }

    // 7b) Create the Instantly campaign if not yet created
    let instId = sub!.instantly_campaign_id;
    if (!instId) {
      instId = await createInstantlyCampaign({
        name: `${campaign.name}_${bucketLabel}`,
        dailyLimit: campaign.daily_limit ?? 30,
        windowFrom: campaign.window_from ?? "09:00",
        windowTo: campaign.window_to ?? "18:00",
        timezone: tz,
        sendDays,
        steps,
        emailList,
      });
      await db
        .from("instantly_campaigns")
        .update({ instantly_campaign_id: instId, status: "active", updated_at: new Date().toISOString() })
        .eq("id", sub!.id);
    }

    // 7c) Build per-lead payloads
    const payloads: Array<InstantlyLeadInput & { campaignLeadId: string }> = b.rows.map((r) => {
      const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
      return {
        campaignLeadId: r.id,
        email: lead!.email!,
        firstName: lead!.first_name ?? "",
        lastName: lead!.last_name ?? "",
        customVariables: buildCustomVariables(draftsForLead(r.lead_id), campaign.sender_name),
      };
    });

    // 7d) Push in batches of 100 with 2s gap
    for (let i = 0; i < payloads.length; i += BATCH) {
      const slice = payloads.slice(i, i + BATCH);
      const result = await addLeadsToInstantly(instId, slice);
      const byEmail = new Map(
        (result.created_leads ?? []).map((c) => [c.email.toLowerCase(), c.id]),
      );
      const now = new Date().toISOString();
      await Promise.all(
        slice.map((p) =>
          db
            .from("campaign_leads")
            .update({
              instantly_campaign_id: sub!.id,
              instantly_lead_id: byEmail.get(p.email.toLowerCase()) ?? null,
              crm_status: "sent",
              updated_at: now,
            })
            .eq("id", p.campaignLeadId),
        ),
      );
      totalSent += slice.length;
      if (i + BATCH < payloads.length) await sleep(2000);
    }

    // 7e) Activate if not human-in-loop
    if (!campaign.human_in_loop) {
      await activateInstantlyCampaign(instId);
    }

    await db
      .from("instantly_campaigns")
      .update({
        lead_count: b.rows.length,
        sent_count: b.rows.length,
        activated_at: campaign.human_in_loop ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub!.id);
  }

  // 8) Roll up master campaign counter + status
  await db
    .from("campaigns")
    .update({
      status: campaign.human_in_loop ? "draft" : "active",
      sent_count: (campaign.sent_count ?? 0) + totalSent,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  return { buckets: buckets.size, sent: totalSent };
}
