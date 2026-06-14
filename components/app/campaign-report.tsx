"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { BarChart2, Mail, MessageSquare, Send, Users, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const DONUT_COLORS = [
  "#71717a", "#3b82f6", "#06b6d4", "#14b8a6", "#22c55e", "#10b981", "#52525b",
];

export type CampaignReportData = {
  campaignId: string;
  totals: {
    leads: number;
    draftsGenerated: number;
    certified: number;
    sent: number;
    replied: number;
    won: number;
    closed: number;
    failed: number;
  };
  rates: { replyRate: number; certifyRate: number };
  stageDistribution: Array<{ stage: string; label: string; count: number }>;
};

function StatCard({
  title, value, icon: Icon, sub,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="w-fit p-2 rounded-lg mb-3 border border-border bg-secondary">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-sm font-medium text-foreground/80">{title}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function DonutTooltip({ active, payload }: {
  active?: boolean;
  payload?: { name: string; value: number }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-border bg-card shadow-xl px-3 py-2 text-xs">
      <span className="font-semibold">{p.name}: </span>
      <span className="tabular-nums">{p.value}</span>
    </div>
  );
}

export function CampaignReportView({ report }: { report: CampaignReportData }) {
  const { totals, rates, stageDistribution } = report;
  const donutData = stageDistribution.map((s, i) => ({
    name: s.label,
    value: s.count,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Campaign report</p>
        <h2 className="text-lg font-bold">Performance overview</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Leads" value={totals.leads} icon={Users} />
        <StatCard title="Drafts" value={totals.draftsGenerated} icon={BarChart2} sub={`${rates.certifyRate}% certified`} />
        <StatCard title="Certified" value={totals.certified} icon={CheckCircle2} />
        <StatCard title="Sent" value={totals.sent} icon={Send} />
        <StatCard title="Replied" value={totals.replied} icon={MessageSquare} sub={`${rates.replyRate}% reply rate`} />
        <StatCard title="Won" value={totals.won} icon={Mail} sub={`${totals.closed} closed`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="text-sm font-semibold mb-1">Stage distribution</h3>
          <p className="text-xs text-muted-foreground mb-4">Leads by campaign journey stage</p>
          {donutData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {donutData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="flex flex-wrap gap-3 mt-2">
            {donutData.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 flex flex-col justify-center gap-6">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Sent vs Replied</p>
            <div className="flex items-end gap-4">
              <div>
                <p className="text-4xl font-bold tabular-nums">{totals.sent}</p>
                <p className="text-sm text-muted-foreground">Sent</p>
              </div>
              <div className="text-2xl text-muted-foreground pb-1">→</div>
              <div>
                <p className={cn("text-4xl font-bold tabular-nums", totals.replied > 0 && "text-green-400")}>
                  {totals.replied}
                </p>
                <p className="text-sm text-muted-foreground">Replied</p>
              </div>
            </div>
          </div>
          {totals.failed > 0 && (
            <p className="text-sm text-red-400">{totals.failed} draft(s) failed generation</p>
          )}
        </div>
      </div>
    </div>
  );
}
