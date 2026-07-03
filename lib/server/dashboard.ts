import type { SupabaseClient } from "@supabase/supabase-js";

const ENRICHED_STATUSES = new Set(["enriching", "enriched", "open", "closed"]);

const STAGE_NAMES = ["New", "Input Required", "Enriched", "Won", "Closed"] as const;
const STAGE_DONUT_COLORS = ["#71717a", "#ca8a04", "#2563eb", "#22c55e", "#6b7280"];

function dbStatusToStage(status: string): (typeof STAGE_NAMES)[number] {
  if (status === "input_required") return "Input Required";
  if (status === "enriched" || status === "enriching") return "Enriched";
  if (status === "open") return "Won";
  if (status === "closed") return "Closed";
  return "New";
}

export type DashboardAnalytics = {
  temperatureBreakdown: { hot: number; cold: number; ooo: number; unsubscribed: number; unclassified: number };
  pendingReplies: Array<{
    id: string;
    campaignId: string;
    campaignName: string;
    leadEmail: string | null;
    preview: string;
    createdAt: string;
  }>;
  totalLeads: number;
  enrichedLeads: number;
  pipelineGrowth: Array<{ month: string; leads: number }>;
  stageDonutData: Array<{ name: string; value: number; color: string }>;
};

export async function getDashboardAnalytics(db: SupabaseClient): Promise<DashboardAnalytics> {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [
    { count: totalLeads },
    { data: tempRows },
    { data: pending },
    { data: statusRows },
    { data: recentLeadRows },
  ] = await Promise.all([
    db.from("leads").select("id", { count: "exact", head: true }).eq("is_deleted", false),
    db.from("campaign_leads").select("lead_temperature"),
    db
      .from("reply_drafts")
      .select(`
        id, subject, created_at, campaign_id,
        campaigns:campaign_id ( name ),
        reply_events:reply_event_id ( lead_email, reply_body )
      `)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(8),
    db.from("leads").select("status").eq("is_deleted", false),
    db
      .from("leads")
      .select("created_at")
      .eq("is_deleted", false)
      .gte("created_at", sixMonthsAgo.toISOString()),
  ]);

  const temperatureBreakdown = { hot: 0, cold: 0, ooo: 0, unsubscribed: 0, unclassified: 0 };
  for (const row of tempRows ?? []) {
    const t = row.lead_temperature;
    if (t === "hot") temperatureBreakdown.hot++;
    else if (t === "cold") temperatureBreakdown.cold++;
    else if (t === "ooo") temperatureBreakdown.ooo++;
    else if (t === "unsubscribed") temperatureBreakdown.unsubscribed++;
    else temperatureBreakdown.unclassified++;
  }

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

  let enrichedLeads = 0;
  const stageCounts: Record<(typeof STAGE_NAMES)[number], number> = {
    New: 0,
    "Input Required": 0,
    Enriched: 0,
    Won: 0,
    Closed: 0,
  };
  const monthlyCounts: Record<string, number> = {};

  for (const row of statusRows ?? []) {
    if (ENRICHED_STATUSES.has(row.status)) enrichedLeads++;
    stageCounts[dbStatusToStage(row.status)]++;
  }
  for (const row of recentLeadRows ?? []) {
    const key = (row.created_at as string).slice(0, 7);
    monthlyCounts[key] = (monthlyCounts[key] ?? 0) + 1;
  }

  const now = new Date();
  const monthLabels = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return d.toLocaleDateString("en-US", { month: "short" });
  });
  const monthKeys = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  let cumulative = 0;
  const pipelineGrowth = monthKeys.map((key, i) => {
    cumulative += monthlyCounts[key] ?? 0;
    return { month: monthLabels[i], leads: cumulative };
  });

  const stageDonutData = STAGE_NAMES
    .map((name, i) => ({
      name,
      value: stageCounts[name],
      color: STAGE_DONUT_COLORS[i],
    }))
    .filter((d) => d.value > 0);

  return {
    temperatureBreakdown,
    pendingReplies,
    totalLeads: totalLeads ?? 0,
    enrichedLeads,
    pipelineGrowth,
    stageDonutData,
  };
}
