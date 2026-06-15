"use client";

import { bulkDeleteLeads } from "@/lib/api-client";

import { useRef, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  type Lead,
  type LeadStatus,
  type LeadScore,
  type LeadSource,
  type LeadsSort,
  isCampaignEligible,
  campaignIneligibleReason,
  sortLeads,
  PIPELINE_STAGES,
  STATUS_LABELS,
  CAMPAIGN_ACTION_HELP,
  type EnrichmentStage,
} from "@/lib/leads";
import { useApp } from "@/lib/app-context";
import { Avatar, ScoreBadge, StatusBadge } from "@/components/leads/lead-ui";
import { KanbanBoard } from "@/components/app/kanban-board";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Users, Megaphone, Plus, List, Kanban, RefreshCw, Columns3, Check,
  Search, Building2, SlidersHorizontal, X, Trash2,
} from "lucide-react";

// ── Types & constants ─────────────────────────────────────────────────────────

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

// ── Status dot ────────────────────────────────────────────────────────────────

const STATUS_DOT: Record<LeadStatus, string> = {
  "Input Required": "bg-yellow-400",
  New:       "bg-zinc-400",
  Enriching: "bg-amber-400",
  Enriched:  "bg-blue-400",
  Open:      "bg-green-400",
  Closed:    "bg-zinc-300",
};

function StatusDot({ status }: { status: LeadStatus }) {
  return (
    <span
      className={cn("size-2 rounded-full inline-block", STATUS_DOT[status])}
      title={status}
    />
  );
}

// ── Enrichment pipeline dot ───────────────────────────────────────────────────

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

// ── Filters modal helpers ─────────────────────────────────────────────────────

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
    value: s, label: STATUS_LABELS[s], dot: STATUS_DOT[s],
  }));
  const scoreOptions: DropdownOption<LeadScore>[] = ALL_SCORES.map((s) => ({
    value: s, label: s === "Hot" ? "Hot Lead" : s === "Cold" ? "Cold Lead" : "Unscored", dot: SCORE_DOT[s],
  }));
  const sourceOptions: DropdownOption<LeadSource>[] = ALL_SOURCES.map((s) => ({
    value: s, label: s,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <p className="text-sm font-semibold">Filters</p>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>
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

// ── Main leads page ───────────────────────────────────────────────────────────

export default function LeadsPage() {
  const {
    leads,
    session,
    loadLeads,
    loadingLeads,
    checkedIds,
    setCheckedIds,
    setSelectedLead,
    setSelectedOrgId,
    setShowAddLeads,
    setManualPrefill,
    setShowCreateCampaign,
    setDeletingLead,
  } = useApp();

  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  const [leadsViewMode,   setLeadsViewMode  ] = useState<LeadsViewMode>(
    (searchParams.get("view") as LeadsViewMode) || "list"
  );
  const [leadsEntityMode, setLeadsEntityMode] = useState<LeadsEntityMode>(
    (searchParams.get("entity") as LeadsEntityMode) || "individual"
  );
  const [visibleCols,     setVisibleCols    ] = useState<ColVisibility>(DEFAULT_VISIBILITY);
  const [searchQuery,     setSearchQuery    ] = useState(searchParams.get("q") ?? "");
  const [leadsSort,       setLeadsSort      ] = useState<LeadsSort>(
    (searchParams.get("sort") as LeadsSort) || "newest"
  );
  const [filters,         setFilters        ] = useState<FilterState>(() => {
    const statusesParam = searchParams.get("statuses");
    const scoresParam   = searchParams.get("scores");
    const sourcesParam  = searchParams.get("sources");
    const fromParam     = searchParams.get("from");
    const toParam       = searchParams.get("to");
    return {
      statuses:    statusesParam ? new Set(statusesParam.split(",") as LeadStatus[]) : new Set(),
      scores:      scoresParam   ? new Set(scoresParam.split(",")   as LeadScore[])  : new Set(),
      sources:     sourcesParam  ? new Set(sourcesParam.split(",")  as LeadSource[]) : new Set(),
      createdFrom: fromParam ? new Date(fromParam) : undefined,
      createdTo:   toParam   ? new Date(toParam)   : undefined,
    };
  });
  const [showFilters, setShowFilters] = useState(false);
  const [page,        setPage       ] = useState(1);
  const [pageSize,    setPageSize   ] = useState(50);

  // Sync filter/view state into URL so refresh preserves it
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery)                  params.set("q",        searchQuery);
    if (leadsSort !== "newest")       params.set("sort",     leadsSort);
    if (leadsViewMode !== "list")     params.set("view",     leadsViewMode);
    if (leadsEntityMode !== "individual") params.set("entity", leadsEntityMode);
    if (filters.statuses.size > 0)   params.set("statuses", [...filters.statuses].join(","));
    if (filters.scores.size   > 0)   params.set("scores",   [...filters.scores].join(","));
    if (filters.sources.size  > 0)   params.set("sources",  [...filters.sources].join(","));
    if (filters.createdFrom)          params.set("from", filters.createdFrom.toISOString().slice(0, 10));
    if (filters.createdTo)            params.set("to",   filters.createdTo.toISOString().slice(0, 10));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchQuery, leadsSort, leadsViewMode, leadsEntityMode, filters, pathname, router]);

  // Reset to page 1 whenever the filtered result set changes
  useEffect(() => { setPage(1); }, [searchQuery, filters, leadsSort]);

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

  const q = searchQuery.trim().toLowerCase();
  const displayLeads = q
    ? sortLeads(
        filteredLeads.filter((l) =>
          `${l.firstName} ${l.lastName} ${l.email} ${l.company} ${l.jobTitle}`.toLowerCase().includes(q)
        ),
        leadsSort,
      )
    : filteredLeads;

  const totalPages = Math.max(1, Math.ceil(displayLeads.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedLeads = displayLeads.slice((safePage - 1) * pageSize, safePage * pageSize);

  const eligibleInView = pagedLeads.filter(isCampaignEligible);
  const allEligibleChecked = eligibleInView.length > 0 && eligibleInView.every((l) => checkedIds.has(l.id));
  const someChecked = pagedLeads.some((l) => checkedIds.has(l.id));
  const checkedCount = pagedLeads.filter((l) => checkedIds.has(l.id)).length;
  const eligibleCheckedCount = pagedLeads.filter((l) => checkedIds.has(l.id) && isCampaignEligible(l)).length;
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
        {someChecked ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold">
              {checkedCount} selected
              {ineligibleCheckedCount > 0 && (
                <span className="text-muted-foreground font-normal"> · {ineligibleCheckedCount} not ready for outreach</span>
              )}
            </span>
            <Button
              size="sm" variant="destructive" className="gap-1.5"
              onClick={async () => {
                if (!session || checkedIds.size === 0) return;
                if (!confirm(`Delete ${checkedIds.size} lead(s)? This cannot be undone.`)) return;
                try {
                  await bulkDeleteLeads(session.access_token, [...checkedIds]);
                  setCheckedIds(new Set());
                  void loadLeads(session.access_token);
                } catch (e) {
                  console.error("Bulk delete failed:", e);
                }
              }}
            >
              <Trash2 className="size-3.5" /> Delete ({checkedIds.size})
            </Button>
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

        <div className="flex items-center gap-2">
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
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="divide-y divide-border animate-pulse">
              <div className="flex items-center gap-4 px-4 py-3">
                {[10, 8, 32, 20, 20, 14, 12, 10].map((w, i) => (
                  <div key={i} className="h-3 bg-secondary rounded" style={{ width: `${w}%` }} />
                ))}
              </div>
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="size-4 rounded bg-secondary shrink-0" />
                  <div className="size-2 rounded-full bg-secondary shrink-0" />
                  <div className="size-8 rounded-full bg-secondary shrink-0" />
                  <div className="h-3 bg-secondary rounded" style={{ width: `${12 + (i % 3) * 4}%` }} />
                  <div className="h-3 bg-secondary rounded" style={{ width: `${8 + (i % 4) * 3}%` }} />
                  <div className="h-3 bg-secondary rounded ml-auto" style={{ width: "10%" }} />
                  <div className="h-5 w-14 bg-secondary rounded-md" />
                  <div className="h-3 bg-secondary rounded" style={{ width: "8%" }} />
                  <div className="h-3 bg-secondary rounded" style={{ width: "7%" }} />
                </div>
              ))}
            </div>
          </div>
        ) : leadsEntityMode === "orgs" ? (() => {
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
                {pagedLeads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-12 text-sm text-muted-foreground">
                      {searchQuery ? `No leads match "${searchQuery}".` : "No leads yet. Click \"Add leads\" to get started."}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedLeads.map((lead) => {
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
                          <button
                            type="button"
                            title="Delete lead"
                            onClick={(e) => { e.stopPropagation(); setDeletingLead(lead); }}
                            className="p-1.5 rounded text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
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

      {/* ── Pagination bar (list view only) ── */}
      {leadsEntityMode === "individual" && leadsViewMode === "list" && displayLeads.length > 0 && (
        <div className="shrink-0 border-t border-border px-8 py-3 flex items-center justify-between gap-4">
          <Field orientation="horizontal" className="w-fit">
            <FieldLabel htmlFor="leads-per-page">Leads per page</FieldLabel>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
            >
              <SelectTrigger className="w-20 h-8 text-xs" id="leads-per-page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              Page {safePage} of {totalPages}
            </span>
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </div>
      )}

      {showFilters && (
        <FiltersModal
          filters={filters}
          onChange={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  );
}
