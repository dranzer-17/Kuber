"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isAdminUser, isValidAdminSession } from "@/lib/auth/admin";
import { type Lead, type LeadStatus, type LeadScore, type LeadSource, type EnrichmentStage, type LeadsSort, isCampaignEligible, campaignIneligibleReason, sortLeads, PIPELINE_STAGES, CAMPAIGN_ACTION_HELP } from "@/lib/leads";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Avatar, ScoreBadge, StatusBadge } from "@/components/leads/lead-ui";
import { KanbanBoard } from "@/components/app/kanban-board";
import { CreateCampaignModal, type Campaign } from "@/components/app/create-campaign-modal";
import { DashboardView } from "@/components/app/dashboard";
import { LeadDrawer } from "@/components/app/lead-drawer";
import { OrgDrawer } from "@/components/app/org-drawer";
import { AddLeadsDrawer } from "@/components/app/add-leads-drawer";
import { CampaignDetail } from "@/components/app/campaign-drawer";
import { SettingsView } from "@/components/app/settings-view";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LayoutDashboard, Users, Megaphone, LogOut, Plus,
  Eye, EyeOff, List, Kanban, RefreshCw, Columns3, Check, Search,
  Building2, SlidersHorizontal, X, Settings, Trash2, AlertTriangle,
} from "lucide-react";
import { fetchLeads, fetchCampaigns, rescrapeOrg, deleteLead, deleteCampaign } from "@/lib/api-client";

type View = "dashboard" | "lead-generation" | "leads" | "campaigns" | "settings";
type LeadsViewMode = "list" | "kanban";
type LeadsEntityMode = "individual" | "orgs";

type FilterState = {
  statuses: Set<LeadStatus>;
  scores: Set<LeadScore>;
  sources: Set<LeadSource>;
  createdFrom: Date | undefined;
  createdTo: Date | undefined;
};

const EMPTY_FILTERS: FilterState = {
  statuses: new Set(),
  scores: new Set(),
  sources: new Set(),
  createdFrom: undefined,
  createdTo: undefined,
};

function isFiltersEmpty(f: FilterState) {
  return (
    f.statuses.size === 0 &&
    f.scores.size === 0 &&
    f.sources.size === 0 &&
    !f.createdFrom &&
    !f.createdTo
  );
}

function activeFilterCount(f: FilterState) {
  return (
    (f.statuses.size > 0 ? 1 : 0) +
    (f.scores.size > 0 ? 1 : 0) +
    (f.sources.size > 0 ? 1 : 0) +
    (f.createdFrom || f.createdTo ? 1 : 0)
  );
}

type OrgRow = {
  id: string;
  name: string;
  domain: string;
  enrichmentStage: EnrichmentStage | null;
  companyDescription: string | null;
  sellsTo: string | null;
  leads: Lead[];
};

// ── Column definitions ────────────────────────────────────────────────────────

const COLUMN_DEFS = [
  { key: "email",        label: "Email",        defaultVisible: true  },
  { key: "job_title",   label: "Job Title",    defaultVisible: true  },
  { key: "status",      label: "Status",       defaultVisible: true  },
  { key: "score",       label: "Score",        defaultVisible: true  },
  { key: "source",      label: "Source",       defaultVisible: true  },
  { key: "added",       label: "Added",        defaultVisible: true  },
  { key: "organization",label: "Organization", defaultVisible: true  },
  { key: "phone",       label: "Phone",        defaultVisible: false },
  { key: "country",     label: "Country",      defaultVisible: false },
  { key: "domain",      label: "Domain",       defaultVisible: false },
  { key: "campaign",    label: "Campaign",     defaultVisible: false },
] as const;

type ColKey = typeof COLUMN_DEFS[number]["key"];
type ColVisibility = Record<ColKey, boolean>;

const DEFAULT_VISIBILITY: ColVisibility = Object.fromEntries(
  COLUMN_DEFS.map((c) => [c.key, c.defaultVisible])
) as ColVisibility;

// ── Columns dropdown ──────────────────────────────────────────────────────────

function ColumnsDropdown({ visible, onChange }: {
  visible: ColVisibility;
  onChange: (v: ColVisibility) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggle(key: ColKey) {
    onChange({ ...visible, [key]: !visible[key] });
  }

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen((o) => !o)}>
        <Columns3 className="size-3.5" />
        Columns
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Toggle columns</p>
          </div>
          <div className="py-1">
            {COLUMN_DEFS.map((col) => (
              <button
                key={col.key}
                type="button"
                onClick={() => toggle(col.key)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary transition-colors"
              >
                <span className={cn(
                  "size-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                  visible[col.key]
                    ? "bg-primary border-primary"
                    : "border-border bg-transparent",
                )}>
                  {visible[col.key] && <Check className="size-2.5 text-primary-foreground" />}
                </span>
                <span className="text-sm text-foreground">{col.label}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => onChange(DEFAULT_VISIBILITY)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Enrichment pipeline dot (orgs) ────────────────────────────────────────────

function EnrichDot({ stage }: { stage: EnrichmentStage | null }) {
  const styles: Record<EnrichmentStage, string> = {
    queued:   "bg-muted-foreground/40",
    scraping: "bg-yellow-400 animate-pulse",
    done:     "bg-green-500",
    failed:   "bg-red-500",
  };
  return (
    <span
      className={cn("size-2 rounded-full inline-block", stage ? styles[stage] : "bg-border")}
      title={stage ?? "not queued"}
    />
  );
}

// ── Status dot (leads list — matches Kanban column colours) ───────────────────

const STATUS_DOT: Record<LeadStatus, string> = {
  "Input Required": "bg-yellow-400",
  New:       "bg-zinc-400",
  Enriching: "bg-amber-400",
  Enriched:  "bg-blue-400",
  Open:      "bg-green-400",
  Closed:    "bg-zinc-300",
};

const CAMPAIGN_STATUS_STYLES: Record<string, { badge: string; dot: string }> = {
  Draft:  { badge: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",  dot: "bg-zinc-400"  },
  Live:   { badge: "bg-green-500/15 text-green-400 border-green-500/25", dot: "bg-green-400" },
  Paused: { badge: "bg-amber-500/15 text-amber-400 border-amber-500/25", dot: "bg-amber-400" },
};

type CampaignStatus = "Draft" | "Live" | "Paused";

function CampaignsListView({
  campaigns,
  onSelect,
  onDeleted,
  token,
}: {
  campaigns: Campaign[];
  onSelect: (c: Campaign) => void;
  onDeleted: (id: string) => void;
  token: string;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "All">("All");
  const [deletingCampaign, setDeletingCampaign] = useState<Campaign | null>(null);
  const [deleteCampaignLoading, setDeleteCampaignLoading] = useState(false);

  const filtered = campaigns.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const counts: Record<CampaignStatus | "All", number> = {
    All: campaigns.length,
    Draft: campaigns.filter((c) => c.status === "Draft").length,
    Live: campaigns.filter((c) => c.status === "Live").length,
    Paused: campaigns.filter((c) => c.status === "Paused").length,
  };

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm text-muted-foreground mb-1">Outreach</p>
        <h1 className="text-2xl font-bold">Campaigns</h1>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search campaigns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-secondary/50 border border-border rounded-lg placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1.5">
          {(["All", "Draft", "Live", "Paused"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                statusFilter === s
                  ? s === "All"
                    ? "bg-foreground text-background border-foreground"
                    : cn(CAMPAIGN_STATUS_STYLES[s]?.badge, "border-current")
                  : "bg-transparent text-muted-foreground border-border hover:border-muted-foreground/40 hover:text-foreground",
              )}
            >
              {s}
              <span className={cn(
                "ml-1.5 tabular-nums",
                statusFilter === s ? "opacity-70" : "opacity-50",
              )}>
                {counts[s]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Campaign list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {campaigns.length === 0
              ? "No campaigns yet. Create one to start sending outreach emails."
              : "No campaigns match your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const style = CAMPAIGN_STATUS_STYLES[c.status] ?? CAMPAIGN_STATUS_STYLES.Draft;
            const replyRate = c.sent > 0 ? Math.round((c.replied / c.sent) * 100) : 0;
            return (
              <div
                key={c.id}
                className="relative group/card rounded-xl border border-border bg-card transition-all hover:bg-secondary/30 hover:border-border/80 hover:shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => onSelect(c)}
                  className="w-full p-5 flex items-center gap-5 text-left"
                >
                  {/* Status dot */}
                  <div className={cn("size-2 rounded-full shrink-0 mt-0.5", style.dot)} />

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold truncate">{c.name}</p>
                      <span className={cn(
                        "text-[10px] font-semibold uppercase tracking-wide border rounded-md px-1.5 py-0.5 shrink-0",
                        style.badge,
                      )}>
                        {c.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "text-[11px] px-1.5 py-0.5 rounded border",
                        c.humanInLoop
                          ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
                          : "text-muted-foreground bg-secondary/50 border-border",
                      )}>
                        {c.humanInLoop ? "Human review" : "Auto-send"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">Created {c.createdAt}</span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-px shrink-0 pr-8">
                    {[
                      { label: "Leads", value: c.leads, color: "text-foreground" },
                      { label: "Sent", value: c.sent, color: "text-foreground" },
                      { label: "Replied", value: c.replied, color: "text-green-400" },
                      { label: "Reply rate", value: `${replyRate}%`, color: replyRate > 0 ? "text-green-400" : "text-muted-foreground" },
                    ].map(({ label, value, color }, idx) => (
                      <div
                        key={label}
                        className={cn(
                          "text-center px-5 py-1",
                          idx < 3 && "border-r border-border",
                        )}
                      >
                        <p className={cn("text-lg font-bold tabular-nums", color)}>{value}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
                      </div>
                    ))}
                  </div>
                </button>

                {/* Delete button — appears on hover */}
                <button
                  type="button"
                  title="Delete campaign"
                  onClick={() => setDeletingCampaign(c)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg opacity-0 group-hover/card:opacity-100 text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <DeleteConfirmModal
        open={!!deletingCampaign}
        title={`Delete "${deletingCampaign?.name}"?`}
        description="This will permanently delete the campaign and all its leads, drafts, and send history. This cannot be undone."
        loading={deleteCampaignLoading}
        onClose={() => { if (!deleteCampaignLoading) setDeletingCampaign(null); }}
        onConfirm={async () => {
          if (!deletingCampaign) return;
          setDeleteCampaignLoading(true);
          try {
            await deleteCampaign(token, deletingCampaign.id);
            onDeleted(deletingCampaign.id);
            setDeletingCampaign(null);
          } finally {
            setDeleteCampaignLoading(false);
          }
        }}
      />
    </div>
  );
}

function DeleteConfirmModal({
  open,
  title,
  description,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-2xl border border-border bg-card shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <div className="shrink-0 size-10 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center">
            <AlertTriangle className="size-5 text-red-400" />
          </div>
          <div>
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: LeadStatus }) {
  return (
    <span
      className={cn("size-2 rounded-full inline-block", STATUS_DOT[status])}
      title={status}
    />
  );
}

// ── Filters modal ─────────────────────────────────────────────────────────────

const ALL_SCORES: LeadScore[]  = ["Hot", "Cold", "—"];
const ALL_SOURCES: LeadSource[] = ["Apollo", "Excel", "Manual"];
const SCORE_DOT: Record<LeadScore, string> = {
  Hot: "bg-orange-400", Cold: "bg-blue-400", "—": "bg-muted-foreground/40",
};

type DropdownOption<T extends string> = {
  value: T;
  label: string;
  dot?: string;
};

function MultiSelectDropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: DropdownOption<T>[];
  selected: Set<T>;
  onChange: (next: Set<T>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggle(val: T) {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val); else next.add(val);
    onChange(next);
  }

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">{label}</p>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-9 flex items-center flex-wrap gap-1.5 px-3 py-1.5 rounded-md border border-input bg-transparent text-left text-sm transition-colors hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {selected.size === 0 ? (
          <span className="text-muted-foreground text-xs">Select {label.toLowerCase()}…</span>
        ) : (
          options
            .filter((o) => selected.has(o.value))
            .map((o) => (
              <span
                key={o.value}
                className="inline-flex items-center gap-1 bg-secondary border border-border rounded px-1.5 py-0.5 text-xs font-medium"
              >
                {o.dot && <span className={cn("size-1.5 rounded-full shrink-0", o.dot)} />}
                {o.label}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); toggle(o.value); }}
                  onKeyDown={(e) => e.key === "Enter" && toggle(o.value)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="size-2.5" />
                </span>
              </span>
            ))
        )}
        <span className="ml-auto text-muted-foreground shrink-0">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-xl overflow-hidden">
          <div className="px-2 py-1.5 border-b border-border">
            <div className="flex items-center gap-2 px-1">
              <Search className="size-3.5 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search or type to add…"
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">No results</p>
            ) : (
              filtered.map((o) => {
                const active = selected.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-secondary",
                      active && "bg-secondary/60"
                    )}
                  >
                    {o.dot && <span className={cn("size-2 rounded-full shrink-0", o.dot)} />}
                    <span className="flex-1 text-left">{o.label}</span>
                    {active && <Check className="size-3.5 text-foreground shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: Date | undefined;
  to: Date | undefined;
  onFromChange: (d: Date | undefined) => void;
  onToChange: (d: Date | undefined) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Created Date</p>
      <div className="grid grid-cols-2 gap-2">
        {/* From */}
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">From</p>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal h-9 px-3 text-xs bg-transparent",
                  !from && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="size-3.5 mr-2 shrink-0" />
                {from ? format(from, "MMM d, yyyy") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={from}
                onSelect={onFromChange}
                disabled={(d: Date) => (to ? d > to : false)}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* To */}
        <div>
          <p className="text-[10px] text-muted-foreground mb-1">To</p>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal h-9 px-3 text-xs bg-transparent",
                  !to && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="size-3.5 mr-2 shrink-0" />
                {to ? format(to, "MMM d, yyyy") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={to}
                onSelect={onToChange}
                disabled={(d: Date) => (from ? d < from : false)}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}

function FiltersModal({
  filters,
  onChange,
  onClose,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<FilterState>({
    statuses:    new Set(filters.statuses),
    scores:      new Set(filters.scores),
    sources:     new Set(filters.sources),
    createdFrom: filters.createdFrom,
    createdTo:   filters.createdTo,
  });

  const statusOptions: DropdownOption<LeadStatus>[] = PIPELINE_STAGES.map((s) => ({
    value: s, label: s, dot: STATUS_DOT[s],
  }));
  const scoreOptions: DropdownOption<LeadScore>[] = ALL_SCORES.map((s) => ({
    value: s, label: s === "—" ? "Unscored" : s, dot: SCORE_DOT[s],
  }));
  const sourceOptions: DropdownOption<LeadSource>[] = ALL_SOURCES.map((s) => ({
    value: s, label: s,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card shadow-xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <p className="text-sm font-semibold">Filters</p>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          <MultiSelectDropdown
            label="Status"
            options={statusOptions}
            selected={draft.statuses}
            onChange={(s) => setDraft((d) => ({ ...d, statuses: s }))}
          />
          <MultiSelectDropdown
            label="Score"
            options={scoreOptions}
            selected={draft.scores}
            onChange={(s) => setDraft((d) => ({ ...d, scores: s }))}
          />
          <MultiSelectDropdown
            label="Source"
            options={sourceOptions}
            selected={draft.sources}
            onChange={(s) => setDraft((d) => ({ ...d, sources: s }))}
          />
          <DateRangePicker
            from={draft.createdFrom}
            to={draft.createdTo}
            onFromChange={(d) => setDraft((prev) => ({ ...prev, createdFrom: d }))}
            onToChange={(d) => setDraft((prev) => ({ ...prev, createdTo: d }))}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0">
          <button
            type="button"
            onClick={() => setDraft({ statuses: new Set(), scores: new Set(), sources: new Set(), createdFrom: undefined, createdTo: undefined })}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => { onChange(draft); onClose(); }}>Apply</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [session,        setSession       ] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loginEmail,     setLoginEmail    ] = useState("");
  const [loginPassword,  setLoginPassword ] = useState("");
  const [showPwd,        setShowPwd       ] = useState(false);
  const [authError,      setAuthError     ] = useState("");
  const [signingIn,      setSigningIn     ] = useState(false);

  const [view,               setView              ] = useState<View>("dashboard");
  const [leadsViewMode,      setLeadsViewMode     ] = useState<LeadsViewMode>("list");
  const [leads,              setLeads             ] = useState<Lead[]>([]);
  const [campaigns,          setCampaigns         ] = useState<Campaign[]>([]);
  const [loadingLeads,       setLoadingLeads      ] = useState(false);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);
  const [showAddLeads,       setShowAddLeads      ] = useState(false);
  const [selectedLead,       setSelectedLead      ] = useState<Lead | null>(null);
  const [visibleCols,        setVisibleCols       ] = useState<ColVisibility>(DEFAULT_VISIBILITY);
  const [checkedIds,         setCheckedIds        ] = useState<Set<string>>(new Set());
  const [searchQuery,        setSearchQuery       ] = useState("");
  const [leadsSort,          setLeadsSort         ] = useState<LeadsSort>("newest");
  const [leadsEntityMode,    setLeadsEntityMode   ] = useState<LeadsEntityMode>("individual");
  const [selectedCampaign,   setSelectedCampaign  ] = useState<Campaign | null>(null);
  const [filters,            setFilters           ] = useState<FilterState>(EMPTY_FILTERS);
  const [showFilters,        setShowFilters       ] = useState(false);
  const [selectedOrgId,      setSelectedOrgId     ] = useState<string | null>(null);
  const [manualPrefill,      setManualPrefill     ] = useState<{
    prefillOrg?: { id?: string; name: string; industry: string; domain: string; country: string };
    prefillLeads?: Array<{ firstName: string; lastName: string; email: string; jobTitle: string; id?: string }>;
    editMode?: boolean;
  } | null>(null);
  const [enrichingIds,       setEnrichingIds      ] = useState<Set<string>>(new Set());
  const [deletingLead,       setDeletingLead      ] = useState<Lead | null>(null);
  const [deleteLeadLoading,  setDeleteLeadLoading ] = useState(false);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!mounted) return;
      if (error || !user) { setSession(null); setLoadingSession(false); return; }
      if (!isAdminUser(user)) { await supabase.auth.signOut(); setSession(null); setLoadingSession(false); return; }
      const { data: { session } } = await supabase.auth.getSession();
      setSession(isValidAdminSession(session) ? session : null);
      setLoadingSession(false);
    }
    void load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_e, s) => {
      if (!mounted) return;
      if (!s?.user || !isAdminUser(s.user) || !isValidAdminSession(s)) {
        if (s?.user && !isAdminUser(s.user)) await supabase.auth.signOut();
        setSession(null); setLoadingSession(false); return;
      }
      setSession(s); setLoadingSession(false);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const loadLeads = useCallback(async (token: string) => {
    setLoadingLeads(true);
    try {
      const { leads } = await fetchLeads(token, { limit: 200 });
      setLeads(leads);
    } catch { /* silently ignore */ }
    finally { setLoadingLeads(false); }
  }, []);

  const loadCampaigns = useCallback(async (token: string) => {
    try {
      const list = await fetchCampaigns(token);
      setCampaigns(list);
    } catch { /* silently ignore */ }
  }, []);

  useEffect(() => {
    if (!session) return;
    const token = session.access_token;
    void loadLeads(token);
    void loadCampaigns(token);
  }, [session, loadLeads, loadCampaigns]);

  // ── Login ─────────────────────────────────────────────────────────────────

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setSigningIn(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    if (error) { setAuthError(error.message); setSigningIn(false); return; }
    if (!isAdminUser(data.user)) {
      await supabase.auth.signOut();
      setAuthError("This account does not have admin access.");
      setSigningIn(false);
      return;
    }
    setSigningIn(false);
  }

  function handleImport() {
    if (session) void loadLeads(session.access_token);
  }

  async function handleEnrichLead(lead: Lead, e: React.MouseEvent) {
    e.stopPropagation();
    if (!lead.orgId || !session) return;
    setEnrichingIds((prev) => new Set(prev).add(lead.id));
    try {
      await rescrapeOrg(session.access_token, lead.orgId);
      setTimeout(() => { if (session) void loadLeads(session.access_token); }, 800);
    } catch { /* non-fatal */ }
    finally {
      setEnrichingIds((prev) => { const next = new Set(prev); next.delete(lead.id); return next; });
    }
  }

  function showEnrichButton(lead: Lead): boolean {
    return lead.enrichmentStage !== "done" && (lead.enrichmentStage === "queued" || lead.enrichmentStage === "failed" || lead.enrichmentStage === null);
  }

  const filteredLeads = sortLeads(
    leads.filter((l) => {
      if (filters.statuses.size > 0 && !filters.statuses.has(l.status)) return false;
      if (filters.scores.size   > 0 && !filters.scores.has(l.score))   return false;
      if (filters.sources.size  > 0 && !filters.sources.has(l.source)) return false;
      if (filters.createdFrom) {
        const leadDate = new Date(l.createdAt);
        leadDate.setHours(0, 0, 0, 0);
        if (leadDate < filters.createdFrom) return false;
      }
      if (filters.createdTo) {
        const to = new Date(filters.createdTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(l.createdAt) > to) return false;
      }
      return true;
    }),
    leadsSort,
  );

  const NAV: { key: View; label: string; icon: React.ComponentType<{ className?: string }>; badge: number | null }[] = [
    { key: "dashboard",  label: "Dashboard",  icon: LayoutDashboard, badge: null         },
    { key: "leads",      label: "Leads",      icon: Users,           badge: leads.length },
    { key: "campaigns",  label: "Campaigns",  icon: Megaphone,       badge: null         },
    { key: "settings",   label: "Settings",   icon: Settings,        badge: null         },
  ];

  // ── Loading / auth gates ──────────────────────────────────────────────────

  if (loadingSession) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          <div className="px-6 py-6 border-b border-border">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="size-8 bg-foreground rounded-lg flex items-center justify-center">
                <span className="text-background text-sm font-black">K</span>
              </div>
              <span className="font-bold text-lg">Kuber</span>
            </div>
            <h1 className="text-2xl font-bold">Sign in</h1>
            <p className="text-sm text-muted-foreground mt-1">Access the lead command center.</p>
          </div>
          <form onSubmit={handleLogin} className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Email</Label>
              <Input type="email" required autoComplete="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="admin@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Password</Label>
              <div className="relative">
                <Input
                  type={showPwd ? "text" : "password"}
                  required autoComplete="current-password"
                  value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••" className="pr-10"
                />
                <button
                  type="button" onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPwd ? "Hide password" : "Show password"}
                >
                  {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {authError && <p className="text-xs text-destructive font-mono">{authError}</p>}
            <Button type="submit" disabled={signingIn} className="w-full">
              {signingIn ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ── App shell ─────────────────────────────────────────────────────────────

  return (
    <>
    <div className="h-screen flex bg-background overflow-hidden">
      <aside className="w-56 shrink-0 border-r border-border flex flex-col bg-card">
        <div className="px-4 py-5 border-b border-border flex items-center gap-2.5">
          <div className="size-8 bg-foreground rounded-lg flex items-center justify-center">
            <span className="text-background text-sm font-black">K</span>
          </div>
          <span className="font-bold">Kuber</span>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map(({ key, label, icon: Icon, badge }) => (
            <button
              key={key} type="button" onClick={() => setView(key)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                view === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{label}</span>
              {badge !== null && (
                <span className="text-[10px] font-semibold bg-secondary rounded-full px-1.5 py-0.5 tabular-nums">{badge}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border space-y-2">
          <p className="text-[11px] text-muted-foreground truncate px-1">{session.user.email}</p>
          <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => supabase.auth.signOut()}>
            <LogOut className="size-3.5" /> Sign out
          </Button>
        </div>
      </aside>

      <main className={cn(
        "flex-1",
        view === "campaigns" && selectedCampaign
          ? "flex flex-col min-h-0 overflow-hidden"
          : "overflow-y-auto",
      )}>

        {/* ── Dashboard ── */}
        {view === "dashboard" && (
          <DashboardView leads={leads} campaigns={campaigns} onNavigate={(v) => setView(v)} />
        )}

        {/* ── Leads ── */}
        {view === "leads" && (() => {
          const q = searchQuery.trim().toLowerCase();
          const displayLeads = q
            ? sortLeads(
                filteredLeads.filter((l) =>
                  `${l.firstName} ${l.lastName} ${l.email} ${l.company} ${l.jobTitle}`.toLowerCase().includes(q)
                ),
                leadsSort,
              )
            : filteredLeads;
          const eligibleInView = displayLeads.filter(isCampaignEligible);
          const allEligibleChecked = eligibleInView.length > 0 && eligibleInView.every((l) => checkedIds.has(l.id));
          const someChecked = displayLeads.some((l) => checkedIds.has(l.id));
          const checkedCount = displayLeads.filter((l) => checkedIds.has(l.id)).length;
          const eligibleCheckedCount = displayLeads.filter((l) => checkedIds.has(l.id) && isCampaignEligible(l)).length;
          const ineligibleCheckedCount = checkedCount - eligibleCheckedCount;
          const canCreateCampaign = eligibleCheckedCount > 0 && ineligibleCheckedCount === 0;

          function toggleAll() {
            if (allEligibleChecked) {
              setCheckedIds((prev) => {
                const next = new Set(prev);
                eligibleInView.forEach((l) => next.delete(l.id));
                return next;
              });
            } else {
              setCheckedIds((prev) => {
                const next = new Set(prev);
                eligibleInView.forEach((l) => next.add(l.id));
                return next;
              });
            }
          }
          function toggleOne(id: string, e: React.MouseEvent) {
            e.stopPropagation();
            const lead = displayLeads.find((l) => l.id === id);
            if (!lead || !isCampaignEligible(lead)) return;
            setCheckedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            });
          }

          return (
            <div className="flex flex-col h-full">
              {/* ── Top bar ── */}
              <div className="flex items-center justify-between px-8 py-4 border-b border-border shrink-0">
                {/* Left: entity toggle or selection state */}
                {someChecked ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold">
                      {checkedCount} selected
                      {ineligibleCheckedCount > 0 && (
                        <span className="text-muted-foreground font-normal"> · {ineligibleCheckedCount} not ready for outreach</span>
                      )}
                    </span>
                    <Button
                      size="sm" className="gap-1.5"
                      disabled={!canCreateCampaign}
                      title={!canCreateCampaign ? "Only enriched leads with a domain can be added to campaigns" : undefined}
                      onClick={() => { setShowCreateCampaign(true); }}
                    >
                      <Megaphone className="size-3.5" /> Create campaign ({eligibleCheckedCount})
                    </Button>
                    <button
                      type="button"
                      onClick={() => setCheckedIds(new Set())}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                    <button
                      type="button" onClick={() => setLeadsEntityMode("individual")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        leadsEntityMode === "individual" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Users className="size-3.5" /> Individual
                    </button>
                    <button
                      type="button" onClick={() => setLeadsEntityMode("orgs")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        leadsEntityMode === "orgs" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Building2 className="size-3.5" /> Organization
                    </button>
                  </div>
                )}

                {/* Right: view toggle + actions */}
                <div className="flex items-center gap-2">
                  {/* List | Kanban toggle — only for individual view */}
                  {leadsEntityMode === "individual" && (
                  <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                    <button
                      type="button" onClick={() => setLeadsViewMode("list")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        leadsViewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <List className="size-3.5" /> List
                    </button>
                    <button
                      type="button" onClick={() => setLeadsViewMode("kanban")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        leadsViewMode === "kanban" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Kanban className="size-3.5" /> Kanban
                    </button>
                  </div>
                  )}
                  <Button
                    variant="outline" size="sm" className="gap-1.5"
                    disabled={loadingLeads}
                    onClick={() => session && loadLeads(session.access_token)}
                  >
                    <RefreshCw className={cn("size-3.5", loadingLeads && "animate-spin")} />
                    Refresh
                  </Button>
                  <Button size="sm" onClick={() => setShowAddLeads(true)} className="gap-1.5">
                    <Plus className="size-3.5" /> Add leads
                  </Button>
                </div>
              </div>

              {/* ── Search + Columns toolbar ── */}
              {leadsEntityMode === "individual" && leadsViewMode === "list" && (
                <div className="flex items-center gap-3 px-8 py-3 border-b border-border shrink-0">
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search leads…"
                      className="pl-8 h-8 text-sm"
                    />
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <Select value={leadsSort} onValueChange={(value) => setLeadsSort(value as LeadsSort)}>
                      <SelectTrigger className="h-8 w-36 gap-2 rounded-md border-border bg-background/80 px-3 text-xs shadow-sm">
                        <SelectValue placeholder="Sort by" />
                      </SelectTrigger>
                      <SelectContent align="end" className="min-w-36">
                        <SelectItem value="newest">Newest first</SelectItem>
                        <SelectItem value="oldest">Oldest first</SelectItem>
                        <SelectItem value="az">A – Z</SelectItem>
                        <SelectItem value="za">Z – A</SelectItem>
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => setShowFilters(true)}
                      className={cn(
                        "relative flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium transition-colors",
                        isFiltersEmpty(filters)
                          ? "border-border bg-background text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                          : "border-primary bg-primary/10 text-primary"
                      )}
                    >
                      <SlidersHorizontal className="size-3.5" />
                      Filters
                      {!isFiltersEmpty(filters) && (
                        <span className="ml-0.5 size-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                          {activeFilterCount(filters)}
                        </span>
                      )}
                    </button>
                    <ColumnsDropdown visible={visibleCols} onChange={setVisibleCols} />
                    <span className="text-xs text-muted-foreground tabular-nums">{displayLeads.length} leads</span>
                  </div>
                </div>
              )}

              {/* ── Content ── */}
              <div className="flex-1 overflow-auto px-8 py-5">
                {loadingLeads ? (
                  <div className="flex items-center justify-center py-16">
                    <p className="text-sm text-muted-foreground">Loading leads...</p>
                  </div>
                ) : leadsEntityMode === "orgs" ? (() => {
                  // Build org rows from leads
                  const orgMap = new Map<string, OrgRow>();
                  for (const lead of leads) {
                    if (!lead.orgId) continue;
                    if (!orgMap.has(lead.orgId)) {
                      orgMap.set(lead.orgId, {
                        id: lead.orgId,
                        name: lead.company,
                        domain: lead.domain,
                        enrichmentStage: lead.enrichmentStage,
                        companyDescription: lead.companyDescription,
                        sellsTo: lead.sellsTo,
                        leads: [],
                      });
                    }
                    orgMap.get(lead.orgId)!.leads.push(lead);
                  }
                  const orgRows = Array.from(orgMap.values());

                  return (
                    <div>
                      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden w-full">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-border hover:bg-transparent">
                              <TableHead className="text-xs font-semibold text-muted-foreground">Organization</TableHead>
                              <TableHead className="text-xs font-semibold text-muted-foreground w-8" title="Enrichment" />
                              <TableHead className="text-xs font-semibold text-muted-foreground">Domain</TableHead>
                              <TableHead className="text-xs font-semibold text-muted-foreground">Description</TableHead>
                              <TableHead className="text-xs font-semibold text-muted-foreground">Sells To</TableHead>
                              <TableHead className="text-xs font-semibold text-muted-foreground text-right">Leads</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {orgRows.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={6} className="text-center py-12 text-sm text-muted-foreground">
                                  No organizations found. Add leads with a domain to populate this view.
                                </TableCell>
                              </TableRow>
                            ) : (
                              orgRows.map((org) => (
                                <TableRow
                                  key={org.id}
                                  onClick={() => setSelectedOrgId(org.id)}
                                  className="cursor-pointer border-border transition-colors hover:bg-secondary/40"
                                >
                                  <TableCell>
                                    <div className="flex items-center gap-2.5">
                                      <div className="size-7 rounded-md bg-secondary border border-border flex items-center justify-center shrink-0">
                                        <Building2 className="size-3.5 text-muted-foreground" />
                                      </div>
                                      <p className="text-sm font-semibold">{org.name || "—"}</p>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <EnrichDot stage={org.enrichmentStage} />
                                  </TableCell>
                                  <TableCell><span className="text-xs text-muted-foreground">{org.domain || "—"}</span></TableCell>
                                  <TableCell className="max-w-xs">
                                    <span className="text-xs text-muted-foreground line-clamp-2">{org.companyDescription || "—"}</span>
                                  </TableCell>
                                  <TableCell className="max-w-xs">
                                    <span className="text-xs text-muted-foreground line-clamp-2">{org.sellsTo || "—"}</span>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <span className="text-xs font-semibold tabular-nums">{org.leads.length}</span>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>

                    </div>
                  );
                })() : leadsViewMode === "kanban" ? (
                  <KanbanBoard leads={leads} onCardClick={(lead) => setSelectedLead(lead)} />
                ) : (
                  <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          {/* Select-all checkbox */}
                          <TableHead className="w-10 pl-4">
                            <span
                              onClick={toggleAll}
                              className={cn(
                                "flex size-4 cursor-pointer rounded border items-center justify-center transition-colors",
                                allEligibleChecked ? "bg-primary border-primary" : someChecked ? "bg-primary/40 border-primary/60" : "border-border hover:border-muted-foreground",
                              )}
                            >
                              {(allEligibleChecked || someChecked) && <Check className="size-2.5 text-primary-foreground" />}
                            </span>
                          </TableHead>
                          <TableHead className="w-12">
                            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-muted-foreground">
                              <InfoTip text={CAMPAIGN_ACTION_HELP.enrichmentColumn} />
                            </span>
                          </TableHead>
                          <TableHead className="text-xs font-semibold text-muted-foreground">Lead</TableHead>
                          {visibleCols.organization && <TableHead className="text-xs font-semibold text-muted-foreground">Organization</TableHead>}
                          {visibleCols.email     && <TableHead className="text-xs font-semibold text-muted-foreground">Email</TableHead>}
                          {visibleCols.phone     && <TableHead className="text-xs font-semibold text-muted-foreground">Phone</TableHead>}
                          {visibleCols.job_title && <TableHead className="text-xs font-semibold text-muted-foreground">Job Title</TableHead>}
                          {visibleCols.status    && (
                            <TableHead className="text-xs font-semibold text-muted-foreground">
                              <span className="inline-flex items-center gap-0.5">
                                Status <InfoTip text={CAMPAIGN_ACTION_HELP.statusColumn} />
                              </span>
                            </TableHead>
                          )}
                          {visibleCols.score     && <TableHead className="text-xs font-semibold text-muted-foreground">Score</TableHead>}
                          {visibleCols.source    && <TableHead className="text-xs font-semibold text-muted-foreground">Source</TableHead>}
                          {visibleCols.domain    && <TableHead className="text-xs font-semibold text-muted-foreground">Domain</TableHead>}
                          {visibleCols.country   && <TableHead className="text-xs font-semibold text-muted-foreground">Country</TableHead>}
                          {visibleCols.campaign  && <TableHead className="text-xs font-semibold text-muted-foreground">Campaign</TableHead>}
                          {visibleCols.added     && <TableHead className="text-xs font-semibold text-muted-foreground">Added</TableHead>}
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayLeads.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={13} className="text-center py-12 text-sm text-muted-foreground">
                              {searchQuery ? `No leads match "${searchQuery}".` : "No leads yet. Click \"Add leads\" to get started."}
                            </TableCell>
                          </TableRow>
                        ) : (
                          displayLeads.map((lead) => {
                            const isChecked = checkedIds.has(lead.id);
                            const eligible = isCampaignEligible(lead);
                            const ineligibleReason = campaignIneligibleReason(lead);
                            return (
                              <TableRow
                                key={lead.id}
                                onClick={() => setSelectedLead(lead)}
                                className={cn(
                                  "cursor-pointer border-border transition-colors hover:bg-secondary/40",
                                  isChecked && "bg-secondary/30",
                                  !eligible && "opacity-60",
                                )}
                              >
                                <TableCell className="pl-4" onClick={(e) => toggleOne(lead.id, e)}>
                                  <span
                                    title={ineligibleReason ?? undefined}
                                    className={cn(
                                      "flex size-4 rounded border items-center justify-center transition-colors",
                                      !eligible && "cursor-not-allowed opacity-40",
                                      eligible && "cursor-pointer",
                                      isChecked && eligible ? "bg-primary border-primary" : eligible ? "border-border hover:border-muted-foreground" : "border-border",
                                    )}
                                  >
                                    {isChecked && eligible && <Check className="size-2.5 text-primary-foreground" />}
                                  </span>
                                </TableCell>
                                <TableCell className="text-center">
                                  <StatusDot status={lead.status} />
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2.5">
                                    <Avatar name={`${lead.firstName} ${lead.lastName}`} size="sm" />
                                    <p className="text-sm font-semibold">{lead.firstName} {lead.lastName}</p>
                                  </div>
                                </TableCell>
                                {visibleCols.organization && <TableCell><span className="text-sm">{lead.company || "—"}</span></TableCell>}
                                {visibleCols.email     && <TableCell><span className="text-xs text-muted-foreground">{lead.email}</span></TableCell>}
                                {visibleCols.phone     && <TableCell><span className="text-xs text-muted-foreground">{lead.phone || "—"}</span></TableCell>}
                                {visibleCols.job_title && <TableCell><span className="text-sm">{lead.jobTitle}</span></TableCell>}
                                {visibleCols.status    && <TableCell><StatusBadge status={lead.status} /></TableCell>}
                                {visibleCols.score     && <TableCell><ScoreBadge score={lead.score} /></TableCell>}
                                {visibleCols.source    && <TableCell><span className="text-xs text-muted-foreground">{lead.source}</span></TableCell>}
                                {visibleCols.domain    && <TableCell><span className="text-xs text-muted-foreground">{lead.domain || "—"}</span></TableCell>}
                                {visibleCols.country   && <TableCell><span className="text-xs text-muted-foreground">{lead.country || "—"}</span></TableCell>}
                                {visibleCols.campaign && (
                                  <TableCell>
                                    {lead.campaigns.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {lead.campaigns.map((c) => (
                                          <span key={c.id} className="text-[10px] font-medium bg-secondary border border-border rounded px-1.5 py-0.5 text-muted-foreground whitespace-nowrap">
                                            {c.name}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
                                )}
                                {visibleCols.added     && <TableCell><span className="text-xs text-muted-foreground">{lead.createdAt.slice(0, 10)}</span></TableCell>}
                                <TableCell className="text-right pr-3" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-0.5">
                                    {showEnrichButton(lead) && lead.orgId && (
                                      <button
                                        type="button"
                                        title={lead.enrichmentStage === "failed" ? "Retry enrichment" : "Enrich"}
                                        onClick={(e) => handleEnrichLead(lead, e)}
                                        disabled={enrichingIds.has(lead.id)}
                                        className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded hover:bg-secondary disabled:opacity-50"
                                      >
                                        <RefreshCw className={cn("size-3.5", enrichingIds.has(lead.id) && "animate-spin")} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      title="Delete lead"
                                      onClick={(e) => { e.stopPropagation(); setDeletingLead(lead); }}
                                      className="p-1.5 rounded text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Campaigns ── */}
        {view === "campaigns" && (
          selectedCampaign ? (
            <CampaignDetail
              campaign={selectedCampaign}
              onBack={() => setSelectedCampaign(null)}
            />
          ) : (
          <CampaignsListView
            campaigns={campaigns}
            onSelect={setSelectedCampaign}
            onDeleted={(id) => setCampaigns((prev) => prev.filter((c) => c.id !== id))}
            token={session?.access_token ?? ""}
          />
          )
        )}

        {view === "settings" && <SettingsView />}
      </main>
    </div>

    {/* Overlays — outside the root flex container so they don't affect layout */}
    <DeleteConfirmModal
      open={!!deletingLead}
      title={`Delete ${deletingLead ? `${deletingLead.firstName} ${deletingLead.lastName}`.trim() : "lead"}?`}
      description="This will permanently remove the lead and all associated data. This cannot be undone."
      loading={deleteLeadLoading}
      onClose={() => { if (!deleteLeadLoading) setDeletingLead(null); }}
      onConfirm={async () => {
        if (!deletingLead || !session) return;
        setDeleteLeadLoading(true);
        try {
          await deleteLead(session.access_token, deletingLead.id);
          setLeads((prev) => prev.filter((l) => l.id !== deletingLead.id));
          setDeletingLead(null);
        } finally {
          setDeleteLeadLoading(false);
        }
      }}
    />

    {showFilters && (
      <FiltersModal
        filters={filters}
        onChange={setFilters}
        onClose={() => setShowFilters(false)}
      />
    )}

    <CreateCampaignModal
      open={showCreateCampaign}
      onClose={() => { setShowCreateCampaign(false); setCheckedIds(new Set()); }}
      onCreated={(c) => {
        setCampaigns((p) => [c, ...p]);
        setView("campaigns");
        setSelectedCampaign(c);
        setShowCreateCampaign(false);
        setCheckedIds(new Set());
        if (session) void loadCampaigns(session.access_token);
      }}
      leads={leads.filter((l) => checkedIds.has(l.id) && isCampaignEligible(l))}
    />

    <AddLeadsDrawer
      open={showAddLeads}
      onClose={() => { setShowAddLeads(false); setManualPrefill(null); }}
      onImport={handleImport}
      defaultTab={manualPrefill ? "manual" : "apollo"}
      prefillOrg={manualPrefill?.prefillOrg}
      prefillLeads={manualPrefill?.prefillLeads}
      editMode={manualPrefill?.editMode}
    />

    <LeadDrawer
      lead={selectedLead}
      onClose={() => setSelectedLead(null)}
      onLeadUpdated={(updated) => {
        setLeads((prev) => prev.map((l) => l.id === updated.id ? updated : l));
        setSelectedLead(updated);
      }}
      onOrgClick={(id) => setSelectedOrgId(id)}
    />

    <OrgDrawer
      orgId={selectedOrgId}
      onClose={() => setSelectedOrgId(null)}
      onAddLead={(org) => {
        setSelectedOrgId(null);
        setSelectedLead(null);
        setManualPrefill({
          prefillOrg: { id: org.id, name: org.name, industry: org.industry, domain: org.domain, country: org.country },
          prefillLeads: org.leads,
          editMode: true,
        });
        setShowAddLeads(true);
      }}
    />
</>
  );
}
