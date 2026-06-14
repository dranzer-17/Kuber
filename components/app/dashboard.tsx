"use client";

import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Activity, Award, BarChart2, Calendar, Mail,
  Megaphone, PieChart as PieIcon,
  TrendingUp, Users, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_ORDER, type Lead } from "@/lib/leads";
import { Avatar, StatusBadge } from "@/components/leads/lead-ui";
import type { Campaign } from "@/components/app/create-campaign-modal";

// ─── Chart helpers ────────────────────────────────────────────────────────────

const GRID_COLOR = "rgba(255,255,255,0.06)";
const TICK_COLOR = "rgba(255,255,255,0.35)";

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card shadow-xl px-3 py-2.5 text-xs space-y-1">
      {label && <p className="font-medium text-muted-foreground mb-1">{label}</p>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-1.5 rounded-full shrink-0 bg-blue-500" />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({
  title, value, icon: Icon, trend, highlight = false,
}: {
  title: string; value: string | number;
  icon: React.ElementType; trend: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-xl border p-5 transition-all hover:border-blue-500/30",
      highlight ? "bg-blue-600 border-blue-500" : "bg-card border-border",
    )}>
      <div className={cn(
        "w-fit p-2 rounded-lg mb-4 border",
        highlight ? "bg-blue-500/30 border-blue-400/30" : "bg-secondary border-border",
      )}>
        <Icon className={cn("size-4", highlight ? "text-white" : "text-muted-foreground")} />
      </div>
      <div className={cn("text-3xl font-bold mb-1 tabular-nums", highlight ? "text-white" : "text-foreground")}>
        {value}
      </div>
      <div className={cn("text-sm font-medium mb-0.5", highlight ? "text-white/80" : "text-foreground/80")}>
        {title}
      </div>
      <div className={cn("text-xs", highlight ? "text-white/50" : "text-muted-foreground")}>
        {trend}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface DashboardViewProps {
  leads: Lead[];
  campaigns: Campaign[];
  onNavigate: (view: "lead-generation" | "leads" | "campaigns") => void;
}

export function DashboardView({ leads, campaigns, onNavigate }: DashboardViewProps) {
  const totalLeads    = leads.length;
  const hotLeads      = leads.filter((l) => l.score === "Hot").length;
  const enrichedLeads = leads.filter((l) => STATUS_ORDER[l.status] >= 2).length;
  const liveCampaigns = campaigns.filter((c) => c.status === "Live").length;
  const totalSent     = campaigns.reduce((a, c) => a + c.sent, 0);
  const totalReplied  = campaigns.reduce((a, c) => a + c.replied, 0);
  const replyRate     = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

  // Pipeline growth — cumulative leads added per month (last 6 months)
  const now = new Date();
  const monthLabels = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return d.toLocaleDateString("en-US", { month: "short" });
  });
  const monthKeys = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const monthlyCounts: Record<string, number> = {};
  for (const lead of leads) {
    const key = lead.createdAt.slice(0, 7);
    monthlyCounts[key] = (monthlyCounts[key] ?? 0) + 1;
  }
  let cumulative = 0;
  const pipelineGrowth = monthKeys.map((key, i) => {
    cumulative += monthlyCounts[key] ?? 0;
    return { month: monthLabels[i], leads: cumulative };
  });

  // Stage donut
  const STAGE_DONUT_COLORS = [
    "#1e40af","#1d4ed8","#2563eb","#3b82f6","#60a5fa","#93c5fd","#bfdbfe",
  ];
  const STAGE_NAMES = ["New","Enriching","Enriched","Draft Ready","Approved","Won","Closed"] as const;
  const stageDonutData = STAGE_NAMES
    .map((name, i) => ({
      name,
      value: leads.filter((l) => l.status === name).length,
      color: STAGE_DONUT_COLORS[i],
    }))
    .filter((d) => d.value > 0);

  const recentLeads = leads.slice(0, 5);

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Overview</p>
          <h1 className="text-2xl font-bold">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-lg px-3 py-2">
          <Calendar className="size-3.5" />
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Total Leads"    value={totalLeads}      icon={Users}     trend={`${totalLeads} in pipeline`}                                        highlight />
        <StatCard title="Hot Leads"      value={hotLeads}        icon={TrendingUp} trend={`${Math.round(hotLeads / Math.max(totalLeads,1) * 100)}% of total`} />
        <StatCard title="Emails Sent"    value={totalSent}       icon={Mail}      trend={`${campaigns.length} campaigns`}                                     />
        <StatCard title="Reply Rate"     value={`${replyRate}%`} icon={Activity}  trend={`${totalReplied} replies total`}                                     />
        <StatCard title="Live Campaigns" value={liveCampaigns}   icon={Megaphone} trend={`${campaigns.length} total created`}                                 />
        <StatCard title="Enriched"       value={enrichedLeads}   icon={Zap}       trend={`${Math.round(enrichedLeads / Math.max(totalLeads,1) * 100)}% done`} />
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Pipeline Growth */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-semibold">Pipeline Growth</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Cumulative leads over 6 months</p>
            </div>
            <div className="p-2 rounded-lg border border-border bg-secondary">
              <TrendingUp className="size-3.5 text-muted-foreground" />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={pipelineGrowth} margin={{ left: -10, right: 4, top: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="areaBlue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: TICK_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: TICK_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(59,130,246,0.3)", strokeWidth: 1.5 }} />
              <Area
                type="natural" dataKey="leads" name="Leads" stroke="#3b82f6" strokeWidth={2.5}
                fill="url(#areaBlue)"
                dot={{ fill: "#3b82f6", r: 3.5, strokeWidth: 2, stroke: "#0f172a" }}
                activeDot={{ r: 5, fill: "#3b82f6", strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Stage distribution */}
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-semibold">Stage Distribution</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Leads across pipeline stages</p>
            </div>
            <div className="p-2 rounded-lg border border-border bg-secondary">
              <PieIcon className="size-3.5 text-muted-foreground" />
            </div>
          </div>
          {stageDonutData.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">
              No leads yet — add some to see the distribution
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="shrink-0">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={stageDonutData} cx="50%" cy="50%"
                      innerRadius={52} outerRadius={76} paddingAngle={2} dataKey="value" strokeWidth={0}
                    >
                      {stageDonutData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2.5 min-w-0">
                {stageDonutData.map((d) => {
                  const pct = Math.round((d.value / Math.max(totalLeads, 1)) * 100);
                  return (
                    <div key={d.name} className="flex items-center gap-2">
                      <span className="size-2 rounded-full shrink-0" style={{ background: d.color }} />
                      <span className="text-xs text-muted-foreground flex-1 truncate">{d.name}</span>
                      <span className="text-xs font-semibold tabular-nums">{d.value}</span>
                      <span className="text-[10px] text-muted-foreground/50 w-6 text-right tabular-nums">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Recent leads */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-semibold">Recent Leads</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Latest additions to your pipeline</p>
            </div>
            <div className="p-2 rounded-lg border border-border bg-secondary">
              <Activity className="size-3.5 text-muted-foreground" />
            </div>
          </div>
          {recentLeads.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No leads yet. Start by adding leads from the Lead Generation page.
            </p>
          ) : (
            <div className="space-y-1">
              {recentLeads.map((l) => (
                <div key={l.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors">
                  <Avatar name={`${l.firstName} ${l.lastName}`} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{l.firstName} {l.lastName}</p>
                    <p className="text-xs text-muted-foreground truncate">{l.company} · {l.jobTitle}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={l.status} />
                    <span className="text-xs text-muted-foreground">{l.createdAt}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">

          <div className="bg-blue-600 border border-blue-500 rounded-xl p-5">
            <Award className="size-7 text-white/80 mb-3" />
            <h3 className="text-sm font-semibold text-white mb-1">Pipeline overview</h3>
            <p className="text-xs text-white/60 leading-relaxed">
              {hotLeads} hot leads · {totalSent} emails sent · {replyRate}% reply rate.
              Keep enriching and following up to close your pipeline.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold">Monthly Goals</h3>
            {[
              { label: "Leads Added", current: totalLeads,   goal: 50  },
              { label: "Emails Sent", current: totalSent,    goal: 100 },
              { label: "Replies",     current: totalReplied, goal: 20  },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="text-muted-foreground font-medium tabular-nums">{item.current}/{item.goal}</span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${Math.min(Math.round(item.current / item.goal * 100), 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <BarChart2 className="size-3.5 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Suggested Actions</h3>
            </div>
            <ul className="space-y-2.5 text-xs text-muted-foreground">
              {[
                { text: "Review leads awaiting approval", action: () => onNavigate("leads")           },
                { text: "Enrich newly imported leads",    action: () => onNavigate("leads")           },
                { text: "Create Q3 outreach campaign",    action: () => onNavigate("campaigns")       },
                { text: "Add more leads via Apollo",      action: () => onNavigate("lead-generation") },
              ].map((s) => (
                <li
                  key={s.text}
                  onClick={s.action}
                  className="flex items-center gap-2 cursor-pointer hover:text-foreground transition-colors"
                >
                  <span className="size-1.5 rounded-full shrink-0 bg-blue-500" />
                  {s.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
