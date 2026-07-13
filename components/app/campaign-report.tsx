"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { BarChart2, CheckCircle2, Loader2, RotateCcw, Send, Users, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";

const DONUT_COLORS = ["#71717a", "#3b82f6", "#06b6d4", "#14b8a6", "#ef4444"];

export type CampaignReportData = {
  campaignId: string;
  totals: {
    leads: number;
    draftsGenerated: number;
    certified: number;
    sent: number;
    replied: number;
    failed: number;
  };
  rates: { replyRate: number; certifyRate: number };
  draftGeneration: {
    total: number;
    pending: number;
    generating: number;
    succeeded: number;
    failed: number;
    successRate: number;
  };
  stageDistribution: Array<{ stage: string; label: string; count: number }>;
};

function StatCard({
  title, value, icon: Icon, sub, accent,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
  accent?: "red" | "default";
}) {
  return (
    <div className={cn(
      "rounded-xl border p-4",
      accent === "red" ? "border-red-500/30 bg-red-500/5" : "border-border bg-card",
    )}>
      <div className={cn(
        "w-fit p-2 rounded-lg mb-3 border",
        accent === "red" ? "border-red-500/30 bg-red-500/10" : "border-border bg-secondary",
      )}>
        <Icon className={cn("size-4", accent === "red" ? "text-red-400" : "text-muted-foreground")} />
      </div>
      <div className={cn("text-2xl font-bold tabular-nums", accent === "red" && "text-red-400")}>{value}</div>
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

export function CampaignReportView({
  report,
  onRetryAllFailed,
  retrying,
}: {
  report: CampaignReportData;
  onRetryAllFailed?: () => void;
  retrying?: boolean;
}) {
  const { totals, rates, draftGeneration, stageDistribution } = report;
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

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard title="Leads" value={totals.leads} icon={Users} />
        <StatCard title="Drafts" value={totals.draftsGenerated} icon={BarChart2} sub={`${rates.certifyRate}% certified`} />
        <StatCard title="Certified" value={totals.certified} icon={CheckCircle2} />
        <StatCard title="Sent" value={totals.sent} icon={Send} />
        <StatCard
          title="Failed drafts"
          value={draftGeneration.failed}
          icon={AlertCircle}
          accent={draftGeneration.failed > 0 ? "red" : "default"}
          sub={draftGeneration.failed > 0 ? "Needs retry" : "None"}
        />
      </div>

      {/* Draft generation section */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Draft generation</h3>
            <p className="text-xs text-muted-foreground mt-0.5">AI email draft pipeline for this campaign</p>
          </div>
          {draftGeneration.failed > 0 && onRetryAllFailed && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-red-500/30 text-red-400 hover:text-red-300"
              disabled={retrying}
              onClick={onRetryAllFailed}
            >
              {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
              Retry all failed ({draftGeneration.failed})
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: "Total leads", value: draftGeneration.total },
            { label: "Pending", value: draftGeneration.pending },
            { label: "Generating", value: draftGeneration.generating },
            { label: "Succeeded", value: draftGeneration.succeeded },
            { label: "Failed", value: draftGeneration.failed, red: true },
          ].map(({ label, value, red }) => (
            <StatTile key={label} label={label} value={value} tone={red && value > 0 ? "red" : "neutral"} />
          ))}
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Generation success rate</span>
            <span className="tabular-nums font-medium text-foreground">{draftGeneration.successRate}%</span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                draftGeneration.successRate >= 80 ? "bg-green-500" : draftGeneration.successRate >= 50 ? "bg-amber-500" : "bg-red-500",
              )}
              style={{ width: `${draftGeneration.successRate}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Based on {draftGeneration.succeeded + draftGeneration.failed} completed attempts
            {draftGeneration.generating > 0 ? ` · ${draftGeneration.generating} still generating` : ""}
          </p>
        </div>
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

        <div className="bg-card border border-border rounded-xl p-6 flex flex-col justify-center gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Outbound summary</p>
            <div className="flex items-end gap-6 mt-2">
              <div>
                <p className="text-4xl font-bold tabular-nums">{totals.sent}</p>
                <p className="text-sm text-muted-foreground">Sent</p>
              </div>
              <div>
                <p className="text-4xl font-bold tabular-nums text-green-400">{totals.certified}</p>
                <p className="text-sm text-muted-foreground">Certified</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
