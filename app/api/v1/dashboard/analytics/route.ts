import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const db = createAdminClient();

  // Temperature breakdown across every campaign_lead workspace-wide.
  const { data: tempRows } = await db
    .from("campaign_leads")
    .select("lead_temperature");

  const temperatureBreakdown = { hot: 0, cold: 0, ooo: 0, unsubscribed: 0, unclassified: 0 };
  for (const row of tempRows ?? []) {
    const t = row.lead_temperature;
    if (t === "hot") temperatureBreakdown.hot++;
    else if (t === "cold") temperatureBreakdown.cold++;
    else if (t === "ooo") temperatureBreakdown.ooo++;
    else if (t === "unsubscribed") temperatureBreakdown.unsubscribed++;
    else temperatureBreakdown.unclassified++;
  }

  // Most recent reply drafts still awaiting human review, across ALL campaigns —
  // so a reviewer doesn't have to open every campaign individually to find pending work.
  const { data: pending } = await db
    .from("reply_drafts")
    .select(`
      id, subject, created_at, campaign_id,
      campaigns:campaign_id ( name ),
      reply_events:reply_event_id ( lead_email, reply_body )
    `)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(8);

  const pendingReplies = (pending ?? []).map((p) => {
    const campaign = Array.isArray(p.campaigns) ? p.campaigns[0] : p.campaigns;
    const event = Array.isArray(p.reply_events) ? p.reply_events[0] : p.reply_events;
    return {
      id: p.id,
      campaignId: p.campaign_id,
      campaignName: (campaign as { name?: string } | null)?.name ?? "Unknown campaign",
      leadEmail: (event as { lead_email?: string | null } | null)?.lead_email ?? null,
      preview: ((event as { reply_body?: string | null } | null)?.reply_body ?? "").slice(0, 100),
      createdAt: p.created_at,
    };
  });

  return ok({ temperatureBreakdown, pendingReplies });
}
