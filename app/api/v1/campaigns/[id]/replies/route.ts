import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;
  const db = createAdminClient();

  // all reply events for this master campaign + their leads + the latest reply draft
  const { data: events } = await db
    .from("reply_events")
    .select(`
      id, event_type, reply_body, intent_classified, received_at, lead_email, campaign_lead_id,
      campaign_leads:campaign_lead_id ( id, lead_temperature, interest_status, crm_status,
        leads:lead_id ( first_name, last_name, email, title ) )
    `)
    .eq("campaign_id", id)
    .eq("event_type", "reply_received")
    .order("received_at", { ascending: false });

  // latest reply draft per reply_event
  const eventIds = (events ?? []).map((e) => e.id);
  const { data: drafts } = eventIds.length
    ? await db.from("reply_drafts").select("*").in("reply_event_id", eventIds).order("version", { ascending: false })
    : { data: [] as Record<string, unknown>[] };

  const latestByEvent = new Map<string, Record<string, unknown>>();
  for (const d of (drafts ?? [])) {
    if (!latestByEvent.has(d.reply_event_id as string)) latestByEvent.set(d.reply_event_id as string, d);
  }

  const rows = (events ?? []).map((e) => ({ ...e, reply_draft: latestByEvent.get(e.id) ?? null }));
  return ok({ replies: rows });
}
