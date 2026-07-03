import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;
  const db = createAdminClient();

  // All reply events for this master campaign + their leads + the associated reply draft.
  // Ordered OLDEST FIRST so each thread's messages come out in chronological order once
  // grouped below.
  const { data: events } = await db
    .from("reply_events")
    .select(`
      id, event_type, reply_body, intent_classified, received_at, lead_email, campaign_lead_id,
      campaign_leads:campaign_lead_id ( id, lead_temperature, interest_status, crm_status, draft_id,
        leads:lead_id ( first_name, last_name, email, title ),
        email_drafts:draft_id ( subject, body ) )
    `)
    .eq("campaign_id", id)
    .eq("event_type", "reply_received")
    .order("received_at", { ascending: true });

  // ALL reply drafts for these events (not just the latest), ordered oldest-first, so
  // each thread can show every reply we drafted/sent alongside every inbound message
  // it responds to.
  const eventIds = (events ?? []).map((e) => e.id);
  const { data: drafts } = eventIds.length
    ? await db.from("reply_drafts").select("*").in("reply_event_id", eventIds).order("created_at", { ascending: true })
    : { data: [] as Record<string, unknown>[] };

  const draftsByEvent = new Map<string, Record<string, unknown>[]>();
  for (const d of (drafts ?? [])) {
    const key = d.reply_event_id as string;
    if (!draftsByEvent.has(key)) draftsByEvent.set(key, []);
    draftsByEvent.get(key)!.push(d);
  }

  // Group events by campaign_lead_id (fallback to lead_email if somehow null) so every
  // reply from the same person becomes ONE thread, not one separate card per reply.
  type EventRow = NonNullable<typeof events>[number];
  type ThreadEvent = EventRow & { reply_drafts: Record<string, unknown>[] };
  const threadsByKey = new Map<string, ThreadEvent[]>();

  for (const e of (events ?? [])) {
    const key = (e.campaign_lead_id as string | null) ?? `email:${e.lead_email}`;
    const enriched = { ...e, reply_drafts: draftsByEvent.get(e.id as string) ?? [] } as ThreadEvent;
    if (!threadsByKey.has(key)) threadsByKey.set(key, []);
    threadsByKey.get(key)!.push(enriched);
  }

  const threads = Array.from(threadsByKey.entries()).map(([key, msgs]) => {
    const latest = msgs[msgs.length - 1];
    const cl = latest.campaign_leads as unknown as Record<string, unknown> | null;
    return {
      thread_key: key,
      campaign_lead_id: latest.campaign_lead_id,
      lead_email: latest.lead_email,
      lead: cl?.leads ?? null,
      original_email: cl?.email_drafts ?? null,
      latest_temperature: cl?.lead_temperature ?? null,
      latest_received_at: latest.received_at,
      messages: msgs, // chronological: each has reply_body + its own reply_drafts[]
    };
  });

  // Most recently active thread first.
  threads.sort((a, b) => String(b.latest_received_at).localeCompare(String(a.latest_received_at)));

  return ok({ threads });
}
