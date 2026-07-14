import { createAdminClient } from "@/lib/supabase/admin";
import { COUNTRY_TO_TIMEZONE } from "@/lib/constants";
import {
  createInstantlyCampaign,
  addLeadsToInstantly,
  activateInstantlyCampaign,
  patchInstantlySequences,
  buildCustomVariables,
  type InstantlyStep,
  type InstantlyLeadInput,
} from "@/lib/services/instantly";
import { toInstantlyTimezone } from "@/lib/instantly-timezones";

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
    // ISO-2 for the UK is GB (planning.md Phase 6.6)
    "united kingdom": "GB", "uk": "GB", "great britain": "GB", "england": "GB",
    "germany": "DE", "france": "FR", "poland": "PL",
    "italy": "IT", "spain": "ES", "netherlands": "NL", "belgium": "BE",
    "sweden": "SE", "switzerland": "CH", "austria": "AT", "portugal": "PT",
    "united arab emirates": "AE", "uae": "AE", "qatar": "QA", "oman": "OM",
    "kuwait": "KW", "bahrain": "BH", "israel": "IL",
    "turkey": "TR", "saudi arabia": "SA", "vietnam": "VN",
    "thailand": "TH", "indonesia": "ID", "malaysia": "MY",
    "singapore": "SG", "philippines": "PH", "japan": "JP", "south korea": "KR",
    "china": "CN", "brazil": "BR", "mexico": "MX", "argentina": "AR",
    "egypt": "EG", "nigeria": "NG", "kenya": "KE",
    "south africa": "ZA", "australia": "AU", "new zealand": "NZ", "canada": "CA",
  };
  const key = (countryName ?? "").trim().toLowerCase();
  return MAP[key] ?? "XX";
}

function pickTimezone(
  leadTimezones: Array<string | null>,
  countryName: string | null,
  masterFallback: string,
): string {
  let tz = masterFallback;

  // 1. modal from Apollo-provided lead.time_zone values for this bucket
  const counts = new Map<string, number>();
  for (const t of leadTimezones) {
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  if (counts.size > 0) {
    tz = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  // 2. country default from constants
  else if (countryName && COUNTRY_TO_TIMEZONE[countryName]) {
    tz = COUNTRY_TO_TIMEZONE[countryName];
  }

  // Instantly API rejects UTC/Etc/UTC and many IANA zones not in their enum.
  if (tz === "UTC" || tz === "Etc/UTC") {
    return toInstantlyTimezone("UTC");
  }

  return toInstantlyTimezone(tz);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function sendCampaign(
  campaignId: string,
  _actorId: string,
  opts?: { campaignLeadIds?: string[] },
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

  // Idempotency guard (§1.5): claim an exclusive send lock so a double-click or a
  // second admin cannot push the same leads to Instantly twice. Auto-expires after
  // 10 minutes so a crashed prior send doesn't wedge the campaign. Requires the
  // campaigns.send_lock_at column (2026_07_14 migration).
  const LOCK_STALE_MS = 10 * 60 * 1000;
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  const { data: claimed, error: lockErr } = await db
    .from("campaigns")
    .update({ send_lock_at: new Date().toISOString() })
    .eq("id", campaignId)
    .or(`send_lock_at.is.null,send_lock_at.lt.${staleBefore}`)
    .select("id");
  if (lockErr) {
    // Column not present yet (migration not applied) — degrade to NO lock rather
    // than block every send. The lock activates automatically once the migration runs.
    console.warn("send lock unavailable (skipping):", lockErr.message);
  } else if (!claimed || claimed.length === 0) {
    throw new Error("A send is already in progress for this campaign — please wait for it to finish.");
  }

  try {

  // ── TEST MODE ──────────────────────────────────────────────────────────────
  // INSTANTLY_TEST_MODE=true => override schedule so Instantly sends ASAP
  // (24h window, all 7 days) instead of queuing until the next configured window.
  // ⚠️ TURN OFF IN PRODUCTION — otherwise emails can go out at 3am local time.
  const isTestMode = process.env.INSTANTLY_TEST_MODE === "true";
  if (isTestMode) {
    console.warn(
      "⚠️ INSTANTLY_TEST_MODE=true — campaign schedules are OVERRIDDEN to 24×7. " +
      "Emails may send at any hour. Never enable this in production.",
    );
  }
  const effWindowFrom = isTestMode ? "00:00" : (campaign.window_from ?? "09:00");
  const effWindowTo   = isTestMode ? "23:59" : (campaign.window_to ?? "18:00");
  const effSendDays: Record<string, boolean> = isTestMode
    ? { "0": true, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true }
    : sendDays;

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
    throw new Error("INSTANTLY_SENDING_ACCOUNTS env var is empty — set comma-separated sender emails");
  }

  // 4) Eligible leads (certified, not yet pushed to Instantly)
  let eligibleQuery = db
    .from("campaign_leads")
    .select(`
      id, lead_id,
      leads:lead_id ( email, first_name, last_name, country, time_zone )
    `)
    .eq("campaign_id", campaignId)
    .eq("crm_status", "approved")
    .is("instantly_campaign_id", null);

  if (opts?.campaignLeadIds?.length) {
    eligibleQuery = eligibleQuery.in("id", opts.campaignLeadIds);
  }

  const { data: cls, error: clsErr } = await eligibleQuery;
  if (clsErr) throw new Error(clsErr.message);

  if (opts?.campaignLeadIds?.length && (cls?.length ?? 0) !== opts.campaignLeadIds.length) {
    throw new Error("Some selected leads are not eligible to send");
  }

  let totalSent = 0;
  const bucketErrors: string[] = [];
  const eligibleCount = cls?.length ?? 0;

  // 5) Push NEW leads (only when there are any) ───────────────────────────────
  if (cls && cls.length > 0) {
    const leadIds = cls.map((r) => r.lead_id);

    // Active drafts (highest version per lead+step)
    const { data: allDrafts } = await db
      .from("email_drafts")
      .select("lead_id,step_number,subject,body,version")
      .eq("campaign_id", campaignId)
      .in("lead_id", leadIds)
      .eq("status", "approved");

    const draftMap = new Map<string, Map<number, { subject: string | null; body: string | null }>>();
    for (const d of ((allDrafts ?? []).sort((a, b) => (b.version ?? 0) - (a.version ?? 0)))) {
      if (!draftMap.has(d.lead_id)) draftMap.set(d.lead_id, new Map());
      const byStep = draftMap.get(d.lead_id)!;
      if (!byStep.has(d.step_number)) byStep.set(d.step_number, { subject: d.subject, body: d.body });
    }
    const draftsForLead = (leadId: string) =>
      [...(draftMap.get(leadId) ?? new Map()).entries()].map(([step_number, v]) => ({ step_number, ...v }));

    // Bucket leads by country
    type ClRow = (typeof cls)[number];
    const buckets = new Map<string, { code: string; countryName: string | null; rows: ClRow[] }>();
    for (const r of cls) {
      const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
      const countryName = lead?.country ?? null;
      const code = resolveCountryCode(countryName);
      if (!buckets.has(code)) buckets.set(code, { code, countryName, rows: [] });
      buckets.get(code)!.rows.push(r);
    }

    for (const b of buckets.values()) {
      try {
        const tz = pickTimezone(
          b.rows.map((r) => {
            const l = Array.isArray(r.leads) ? r.leads[0] : r.leads;
            return l?.time_zone ?? null;
          }),
          b.countryName,
          fallbackTz,
        );
        const bucketLabel = b.countryName ?? "Other";

        // Upsert sub-campaign row (status stays 'creating' until real activation in step 6)
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

        // Create the Instantly campaign if not yet created (TEST-MODE-aware schedule)
        let instId = sub!.instantly_campaign_id;
        if (!instId) {
          instId = await createInstantlyCampaign({
            name: `${campaign.name}_${bucketLabel}`,
            dailyLimit: campaign.daily_limit ?? 30,
            windowFrom: effWindowFrom,
            windowTo: effWindowTo,
            timezone: tz,
            sendDays: effSendDays,
            steps,
            emailList,
          });
          await db
            .from("instantly_campaigns")
            .update({ instantly_campaign_id: instId, updated_at: new Date().toISOString() })
            .eq("id", sub!.id);
        } else {
          // Sub-campaign already exists on Instantly — keep its sequence in sync
          // with campaign_steps. Without this, steps added/edited after the first
          // send (e.g. a new follow-up step) never reach Instantly, since it only
          // learns the sequence at creation time otherwise.
          await patchInstantlySequences(instId, steps);
        }

        // Build per-lead payloads (carry leadId so we can flip their drafts to 'sent')
        const payloads = b.rows.map((r) => {
          const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
          const firstName = (lead?.first_name ?? "").trim() || "there";
          const vars = buildCustomVariables(draftsForLead(r.lead_id), campaign.sender_name);
          // Seed generic fallback for any follow-up step that has no personalized draft yet.
          // The step template body is {{customBodyN}} — without a value here Instantly would
          // render a blank email. When the user later saves a personalized draft, syncApprovedDraftToInstantly
          // overwrites this variable on the lead.
          for (let si = 1; si < steps.length; si++) {
            const key = `customBody${si + 1}`;
            if (!vars[key]) {
              vars[key] = `Hi ${firstName},<br><br>Just following up on my previous note — would love your thoughts.<br><br>Best regards`;
            }
          }
          return {
            campaignLeadId: r.id,
            leadId: r.lead_id,
            email: lead!.email!,
            firstName: lead!.first_name ?? "",
            lastName: lead!.last_name ?? "",
            customVariables: vars,
          };
        });

        // Push in batches of 100 with a 2s gap
        let bucketSent = 0;
        for (let i = 0; i < payloads.length; i += BATCH) {
          const slice = payloads.slice(i, i + BATCH);
          const result = await addLeadsToInstantly(instId, slice);
          const byEmail = new Map(
            (result.created_leads ?? []).map((c) => [c.email.toLowerCase(), c.id]),
          );
          const now = new Date().toISOString();

          // Only leads present in created_leads were actually accepted by Instantly.
          // The rest (invalid/duplicate/skipped) must NOT be reported as 'sent'.
          const sentSlice = slice.filter((p) => byEmail.has(p.email.toLowerCase()));
          const rejectedSlice = slice.filter((p) => !byEmail.has(p.email.toLowerCase()));

          // Accepted → mark sent + capture Instantly lead id + link sub-campaign.
          await Promise.all(
            sentSlice.map((p) =>
              db.from("campaign_leads").update({
                instantly_campaign_id: sub!.id,
                instantly_lead_id: byEmail.get(p.email.toLowerCase()) ?? null,
                crm_status: "sent",
                updated_at: now,
              }).eq("id", p.campaignLeadId),
            ),
          );

          // Rejected → mark failed and still link the sub, so they are visible as
          // needing attention and are NOT silently re-picked as "eligible" forever.
          await Promise.all(
            rejectedSlice.map((p) =>
              db.from("campaign_leads").update({
                instantly_campaign_id: sub!.id,
                crm_status: "failed",
                updated_at: now,
              }).eq("id", p.campaignLeadId),
            ),
          );

          // Mark ONLY the accepted leads' drafts as sent.
          if (sentSlice.length > 0) {
            await db.from("email_drafts")
              .update({ status: "sent", updated_at: now })
              .eq("campaign_id", campaignId)
              .in("lead_id", sentSlice.map((p) => p.leadId))
              .eq("status", "approved");
          }

          bucketSent += sentSlice.length;
          totalSent += sentSlice.length;
          if (i + BATCH < payloads.length) await sleep(2000);
        }

        // Update sub-campaign counters with the ACTUAL accepted count.
        await db.from("instantly_campaigns").update({
          lead_count: b.rows.length,
          sent_count: bucketSent,
          updated_at: new Date().toISOString(),
        }).eq("id", sub!.id);
      } catch (e) {
        const message = (e as Error).message;
        console.error(`Bucket ${b.code} failed:`, message);
        bucketErrors.push(`${b.countryName ?? b.code}: ${message}`);
        // UPDATE (not upsert): the sub row was already created above, and an upsert-insert
        // path here would violate NOT NULL (country/timezone). Records last_error (column
        // added in the 2026_07_14 migration) so the failure is traceable.
        await db.from("instantly_campaigns")
          .update({ status: "failed", last_error: message, updated_at: new Date().toISOString() })
          .eq("campaign_id", campaignId)
          .eq("country_code", b.code);
        continue;
      }
    }

    if (eligibleCount > 0 && totalSent === 0) {
      throw new Error(
        bucketErrors[0]
          ?? "No leads were sent to Instantly. Check campaign timezone and sending window settings.",
      );
    }
  }

  // 6) ACTIVATE every sub-campaign of this master (idempotent) ─────────────────
  // THIS is what actually makes Instantly send. Runs whether or not new leads were
  // pushed, so a previously-stuck campaign also gets activated on re-send.
  const { data: subs } = await db
    .from("instantly_campaigns")
    .select("id,instantly_campaign_id")
    .eq("campaign_id", campaignId)
    .not("instantly_campaign_id", "is", null);

  const activationErrors: string[] = [];
  for (const sub of subs ?? []) {
    if (!sub.instantly_campaign_id) continue;
    try {
      await activateInstantlyCampaign(sub.instantly_campaign_id);
      await db.from("instantly_campaigns").update({
        status: "active",
        activated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", sub.id);
    } catch (e) {
      const message = (e as Error).message;
      activationErrors.push(`sub ${sub.id}: ${message}`);
      await db.from("instantly_campaigns").update({
        status: "failed",
        last_error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", sub.id);
      // Do NOT throw here — keep activating the remaining sub-campaigns so one
      // bad bucket can't strand the others (and the master rollup below still runs).
    }
  }

  // 7) Roll up master campaign status + counter. sent_count is RECONCILED from the
  //    actual data rather than a racy read-modify-write on a value read minutes ago.
  const { count: reconciledSent } = await db
    .from("campaign_leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("crm_status", "sent");

  await db.from("campaigns").update({
    status: "active",
    sent_count: reconciledSent ?? 0,
    updated_at: new Date().toISOString(),
  }).eq("id", campaignId);

  // Only fail the whole send if EVERY sub-campaign activation failed.
  if ((subs?.length ?? 0) > 0 && activationErrors.length === (subs?.length ?? 0)) {
    throw new Error(`All sub-campaign activations failed: ${activationErrors.join("; ")}`);
  }

  return { buckets: (subs ?? []).length, sent: totalSent };
  } finally {
    // Always release the send lock — on success or failure.
    await db.from("campaigns").update({ send_lock_at: null }).eq("id", campaignId);
  }
}
