"use client";

import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Activity, Award, BarChart2, Calendar, Mail,
  Megaphone, PieChart as PieIcon, Tags,
  TrendingUp, Users, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_ORDER, type Lead } from "@/lib/leads";
import { getBatchColor } from "@/lib/constants";
import type { Campaign } from "@/components/app/create-campaign-modal";
import type { ImportBatch } from "@/lib/api-client";

// ─── Chart helpers ────────────────────────────────────────────────────────────

const GRID_COLOR = "var(--border)";
const TICK_COLOR = "var(--muted-foreground)";

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
          <span className="size-1.5 rounded-full shrink-0 bg-primary" />
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
      "rounded-xl border p-5 transition-all hover:border-primary/30",
      highlight ? "bg-primary border-primary" : "bg-card border-border",
    )}>
      <div className={cn(
        "w-fit p-2 rounded-lg mb-4 border",
        highlight ? "bg-primary-foreground/20 border-primary-foreground/20" : "bg-secondary border-border",
      )}>
        <Icon className={cn("size-4", highlight ? "text-primary-foreground" : "text-muted-foreground")} />
      </div>
      <div className={cn("text-3xl font-bold mb-1 tabular-nums", highlight ? "text-primary-foreground" : "text-foreground")}>
        {value}
      </div>
      <div className={cn("text-sm font-medium mb-0.5", highlight ? "text-primary-foreground/80" : "text-foreground/80")}>
        {title}
      </div>
      <div className={cn("text-xs", highlight ? "text-primary-foreground/50" : "text-muted-foreground")}>
        {trend}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface DashboardViewProps {
  leads: Lead[];
  campaigns: Campaign[];
  imports: ImportBatch[];
  onNavigate: (view: "lead-generation" | "leads" | "campaigns") => void;
  onSelectBatch: (label: string) => void;
}

export function DashboardView({ leads, campaigns, imports, onNavigate, onSelectBatch }: DashboardViewProps) {
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
  const STAGE_NAMES = ["New","Input Required","Enriched","Won","Closed"] as const;
  const STAGE_DONUT_COLORS = [
    "#71717a","#ca8a04","#2563eb","#22c55e","#6b7280",
  ];
  const stageDonutData = STAGE_NAMES
    .map((name, i) => ({
      name,
      value: name === "Won"
        ? leads.filter((l) => l.status === "Open").length
        : leads.filter((l) => l.status === name).length,
      color: STAGE_DONUT_COLORS[i],
    }))
    .filter((d) => d.value > 0);

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
                <linearGradient id="areaPrimary" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="var(--primary)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: TICK_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: TICK_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--primary)", strokeWidth: 1.5, strokeOpacity: 0.3 }} />
              <Area
                type="natural" dataKey="leads" name="Leads" stroke="var(--primary)" strokeWidth={2.5}
                fill="url(#areaPrimary)"
                dot={{ fill: "var(--primary)", r: 3.5, strokeWidth: 2, stroke: "var(--background)" }}
                activeDot={{ r: 5, fill: "var(--primary)", strokeWidth: 0 }}
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

        {/* Batches */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-semibold">Batches</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Click a batch to view its leads</p>
            </div>
            <div className="p-2 rounded-lg border border-border bg-secondary">
              <Tags className="size-3.5 text-muted-foreground" />
            </div>
          </div>
          {imports.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No batches yet. Import leads from Apollo, Excel, or manual entry to create one.
            </p>
          ) : (
            <div className="space-y-1">
              {imports.map((b) => {
                const bc = getBatchColor(b.color);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onSelectBatch(b.label)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors text-left"
                  >
                    <span className={cn("size-2.5 rounded-full shrink-0", bc.bg)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{b.label}</p>
                      <p className="text-xs text-muted-foreground truncate capitalize">{b.source}</p>
                    </div>
                    <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium whitespace-nowrap shrink-0", bc.pill)}>
                      {b.lead_count} lead{b.lead_count !== 1 ? "s" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">

          <div className="bg-primary border border-primary rounded-xl p-5">
            <Award className="size-7 text-primary-foreground/80 mb-3" />
            <h3 className="text-sm font-semibold text-primary-foreground mb-1">Pipeline overview</h3>
            <p className="text-xs text-primary-foreground/60 leading-relaxed">
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
                    className="h-full rounded-full bg-primary transition-all"
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
                  <span className="size-1.5 rounded-full shrink-0 bg-primary" />
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
