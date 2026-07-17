import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "crypto";
import { internalAppBaseUrl } from "@/lib/internal-url";
import { listInstantlyCampaignReplies, getInstantlyLeadStatus, getInstantlyEmail } from "@/lib/services/instantly";
import { ingestInstantlyEmail } from "@/lib/services/unibox";
import { INTEREST_TO_TEMPERATURE } from "@/lib/constants";
import { ok } from "@/lib/api-response";
import { assertCampaignAccess } from "@/lib/auth/scope";

function stripQuotedText(text: string | null | undefined): string | null {
  if (!text) return null;
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(">")) break;
    if (/^On .+wrote:\s*$/.test(trimmed)) break;
    if (trimmed === "--" || trimmed === "—") break;
    kept.push(line);
  }
  return kept.join("\n").trim() || null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id: masterCampaignId } = await params;
  const db = createAdminClient();
  try { await assertCampaignAccess(db, user, masterCampaignId); } catch (r) { return r as Response; }

  // 1. Get all sub-campaign Instantly IDs for this master campaign
  const { data: subs } = await db
    .from("instantly_campaigns")
    .select("id, instantly_campaign_id")
    .eq("campaign_id", masterCampaignId);

  if (!subs || subs.length === 0) {
    return ok({ found: 0, backfilled: 0, message: "No Instantly sub-campaigns found" });
  }

  // 2. Fetch existing reply_received event UIDs so we can skip duplicates
  const { data: existingEvents } = await db
    .from("reply_events")
    .select("event_uid, lead_email, received_at")
    .eq("campaign_id", masterCampaignId)
    .eq("event_type", "reply_received");

  const existingKeys = new Set(
    (existingEvents ?? []).map((e) => `${e.lead_email}|${String(e.received_at).slice(0, 16)}`),
  );

  let found = 0;
  let backfilled = 0;

  const baseUrl = internalAppBaseUrl(req);

  for (const sub of subs) {
    let replies: Awaited<ReturnType<typeof listInstantlyCampaignReplies>>;
    try {
      replies = await listInstantlyCampaignReplies(sub.instantly_campaign_id);
    } catch {
      continue; // skip this sub-campaign if Instantly API fails
    }

    found += replies.length;

    for (const email of replies) {
      const fromEmail = email.from_address_email?.toLowerCase().trim()
        ?? email.lead?.toLowerCase().trim()
        ?? null;
      if (!fromEmail) continue;

      const receivedAt = email.timestamp_email ?? new Date().toISOString();
      const dedupeKey = `${fromEmail}|${receivedAt.slice(0, 16)}`;
      const isNew = !existingKeys.has(dedupeKey);

      // Resolve campaign_lead
      let campaignLeadId: string | null = null;
      const { data: lead } = await db
        .from("leads")
        .select("id")
        .eq("email", fromEmail)
        .maybeSingle();

      if (lead) {
        const { data: cl } = await db
          .from("campaign_leads")
          .select("id")
          .eq("campaign_id", masterCampaignId)
          .eq("lead_id", lead.id)
          .maybeSingle();
        if (cl) campaignLeadId = cl.id;
      }

      const replyText = email.body?.text ?? null;
      const replyBody = stripQuotedText(replyText) ?? replyText ?? null;
      const eventUid = createHash("sha256")
        .update(`sync|${receivedAt}|${fromEmail}|${email.id ?? ""}`)
        .digest("hex");

      if (isNew) {
        // Insert the missed reply_event
        const { error: upsertErr } = await db.from("reply_events").upsert(
          {
            event_uid: eventUid,
            campaign_id: masterCampaignId,
            instantly_campaign_id: sub.id,
            campaign_lead_id: campaignLeadId,
            event_type: "reply_received",
            lead_email: fromEmail,
            email_id: email.id ?? null,
            reply_body: replyBody,
            reply_subject: email.subject ?? null,
            received_at: receivedAt,
            created_at: new Date().toISOString(),
          },
          { onConflict: "event_uid", ignoreDuplicates: true },
        );

        if (upsertErr) continue;
      }

      // Resolve reply_event id (new sync row, or prior webhook/sync row by email_id)
      let replyEventId: string | null = null;
      {
        const { data: byUid } = await db
          .from("reply_events")
          .select("id")
          .eq("event_uid", eventUid)
          .maybeSingle();
        replyEventId = byUid?.id ?? null;
        if (!replyEventId && email.id) {
          const { data: byEmail } = await db
            .from("reply_events")
            .select("id")
            .eq("campaign_id", masterCampaignId)
            .eq("email_id", email.id)
            .eq("event_type", "reply_received")
            .maybeSingle();
          replyEventId = byEmail?.id ?? null;
        }
      }

      // Always mirror into unibox — Outbox reads unibox_emails, not reply_events.
      // Idempotent on instantly_email_id, so safe for already-synced rows that
      // previously missed ingest (e.g. webhook down / old sync path).
      try {
        let toIngest = email;
        if (!email.thread_id && email.id) {
          try {
            toIngest = await getInstantlyEmail(email.id);
          } catch {
            // list payload is enough for a best-effort insert
          }
        }
        await ingestInstantlyEmail(db, toIngest, {
          replyEventId: replyEventId ?? undefined,
          masterCampaignId,
          campaignLeadId: campaignLeadId ?? undefined,
        });
      } catch (e) {
        console.error("[sync-replies] unibox ingest failed:", (e as Error).message);
      }

      // Keep campaign_lead status in sync even when the reply_event already existed
      // (e.g. webhook wrote the event but Outbox never got a unibox row).
      if (campaignLeadId) {
        const { data: beforeState } = await db
          .from("campaign_leads")
          .select("crm_status")
          .eq("id", campaignLeadId)
          .maybeSingle();

        const wasAlreadyReplied = beforeState?.crm_status === "replied";

        if (!wasAlreadyReplied || isNew) {
          const leadStatus = await getInstantlyLeadStatus(sub.instantly_campaign_id, fromEmail);
          const interestValue = leadStatus?.interest_value ?? null;
          const temperature = interestValue !== null ? (INTEREST_TO_TEMPERATURE[interestValue as number] ?? null) : null;

          const patch: Record<string, unknown> = {
            crm_status: "replied",
            last_reply_at: receivedAt,
            last_reply_body: replyBody,
            updated_at: new Date().toISOString(),
          };
          if (interestValue !== null) patch.interest_status = interestValue;
          if (temperature) patch.lead_temperature = temperature;

          await db.from("campaign_leads").update(patch).eq("id", campaignLeadId);

          if (!wasAlreadyReplied) {
            try {
              await db.rpc("increment_campaign_counter", {
                p_campaign_id: masterCampaignId,
                p_column: "replied_count",
              });
            } catch { /* non-fatal */ }
            if (!isNew) backfilled++;
          }
        }
      }

      if (!isNew) {
        existingKeys.add(dedupeKey);
        continue;
      }

      // Fire process-reply to generate AI draft (new replies only)
      if (process.env.INTERNAL_SECRET && replyEventId) {
        fetch(`${baseUrl}/api/internal/process-reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": process.env.INTERNAL_SECRET,
          },
          body: JSON.stringify({
            reply_event_id: replyEventId,
            reply_text: replyText ?? "",
            reply_subject: email.subject ?? null,
            email_id: email.id ?? null,
            campaign_lead_id: campaignLeadId,
            master_campaign_id: masterCampaignId,
            lead_email: fromEmail,
          }),
        }).catch(() => {});
      }

      existingKeys.add(dedupeKey);
      backfilled++;
    }
  }

  // Second pass: update interest/temperature for already-replied leads that still have
  // null lead_temperature (e.g. lead_interested webhook was also missed when ngrok was down).
  const { data: nullTempLeads } = await db
    .from("campaign_leads")
    .select("id, leads:lead_id(email)")
    .eq("campaign_id", masterCampaignId)
    .eq("crm_status", "replied")
    .is("lead_temperature", null);

  for (const cl of (nullTempLeads ?? [])) {
    const leadEmail = (cl.leads as { email?: string | null } | null)?.email?.toLowerCase().trim();
    if (!leadEmail) continue;

    for (const sub of subs) {
      const leadStatus = await getInstantlyLeadStatus(sub.instantly_campaign_id, leadEmail);
      const interestValue = leadStatus?.interest_value ?? null;
      if (interestValue === null) continue;

      const temperature = INTEREST_TO_TEMPERATURE[interestValue as number] ?? null;
      await db.from("campaign_leads").update({
        interest_status: interestValue,
        ...(temperature ? { lead_temperature: temperature } : {}),
        updated_at: new Date().toISOString(),
      }).eq("id", cl.id);
      break; // found in one sub-campaign, no need to check others
    }
  }

  return ok({ found, backfilled });
}
