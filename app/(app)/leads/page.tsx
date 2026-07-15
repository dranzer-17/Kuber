"use client";

import { bulkDeleteLeads, bulkAssignLeads, fetchUsers, fetchImports, retryAllFailedEnrichment, type ImportBatch, type Profile, type BulkAssignStrategy, type AssignmentSummary } from "@/lib/api-client";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { getBatchColor } from "@/lib/constants";

import { useRef, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  type Lead,
  type LeadStatus,
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
import { Avatar, StatusBadge } from "@/components/leads/lead-ui";
import { KanbanBoard } from "@/components/app/kanban-board";
import { ServiceHealthBanner } from "@/components/app/service-health-banner";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { AppCheckbox } from "@/components/ui/app-checkbox";
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
  Search, Building2, SlidersHorizontal, X, Trash2, UserPlus, User,
} from "lucide-react";

// ── Types & constants ─────────────────────────────────────────────────────────

type LeadsViewMode = "list" | "kanban";
type LeadsEntityMode = "individual" | "orgs";

const ASSIGN_STRATEGIES: { value: BulkAssignStrategy; label: string; description: string }[] = [
  { value: "manual", label: "Manual", description: "Assign every selected lead to one employee you pick." },
  { value: "round_robin", label: "Round robin", description: "Split the selected leads evenly across all active employees." },
  { value: "territory", label: "Territory-based", description: "Route each selected lead by territory (India vs. foreign) based on its country." },
];

type FilterState = {
  statuses: Set<LeadStatus>;
  assignees: Set<string>;
  sources: Set<LeadSource>;
  batchLabels: Set<string>;
  createdFrom: Date | undefined;
  createdTo: Date | undefined;
};

const EMPTY_FILTERS: FilterState = {
  statuses: new Set(),
  assignees: new Set(),
  sources: new Set(),
  batchLabels: new Set(),
  createdFrom: undefined,
  createdTo: undefined,
};

function isFiltersEmpty(f: FilterState) {
  return (
    f.statuses.size === 0 &&
    f.assignees.size === 0 &&
    f.sources.size === 0 &&
    f.batchLabels.size === 0 &&
    !f.createdFrom &&
    !f.createdTo
  );
}

function activeFilterCount(f: FilterState) {
  return (
    (f.statuses.size > 0 ? 1 : 0) +
    (f.assignees.size > 0 ? 1 : 0) +
    (f.sources.size > 0 ? 1 : 0) +
    (f.batchLabels.size > 0 ? 1 : 0) +
    (f.createdFrom || f.createdTo ? 1 : 0)
  );
}

const UNASSIGNED_FILTER_VALUE = "unassigned";

function assigneeDisplayName(
  assignedTo: string | null,
  session: { user: { id: string } } | null,
  employees: Profile[],
): string {
  if (!assignedTo) return "Unassigned";
  if (session?.user.id === assignedTo) return "You";
  const match = employees.find((e) => e.id === assignedTo);
  return match ? (match.full_name || match.email) : "—";
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
  { key: "assigned",    label: "Assigned",     defaultVisible: true  },
  { key: "source",      label: "Source",       defaultVisible: false },
  { key: "added",       label: "Added",        defaultVisible: true  },
  { key: "organization",label: "Organization", defaultVisible: true  },
  { key: "phone",       label: "Phone",        defaultVisible: false },
  { key: "country",     label: "Country",      defaultVisible: false },
  { key: "domain",      label: "Domain",       defaultVisible: false },
  { key: "campaign",    label: "Campaign",     defaultVisible: false },
  { key: "batch",       label: "Batch",        defaultVisible: true  },
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
      <Button variant="outline" size="sm" className="gap-1.5 bg-card" onClick={() => setOpen((o) => !o)}>
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
                <AppCheckbox checked={!!visible[col.key]} />
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

const ALL_SOURCES: LeadSource[] = ["Apollo", "Excel", "Manual"];

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
        className="w-full min-h-9 flex items-center flex-wrap gap-1.5 px-3 py-1.5 rounded-md border border-input bg-card text-left text-sm transition-colors hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  "w-full justify-start text-left font-normal h-9 px-3 text-xs bg-card",
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
                  "w-full justify-start text-left font-normal h-9 px-3 text-xs bg-card",
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
  imports,
  employees,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  onClose: () => void;
  imports?: ImportBatch[];
  employees?: Profile[];
}) {
  const safeImports = imports ?? [];
  const safeEmployees = employees ?? [];
  const [draft, setDraft] = useState<FilterState>({
    statuses:    new Set(filters.statuses),
    assignees:   new Set(filters.assignees),
    sources:     new Set(filters.sources),
    batchLabels: new Set(filters.batchLabels),
    createdFrom: filters.createdFrom,
    createdTo:   filters.createdTo,
  });

  const statusOptions: DropdownOption<LeadStatus>[] = PIPELINE_STAGES.map((s) => ({
    value: s, label: STATUS_LABELS[s], dot: STATUS_DOT[s],
  }));
  const assigneeOptions: DropdownOption<string>[] = [
    { value: UNASSIGNED_FILTER_VALUE, label: "Unassigned" },
    ...safeEmployees.map((e) => ({ value: e.id, label: e.full_name || e.email })),
  ];
  const sourceOptions: DropdownOption<LeadSource>[] = ALL_SOURCES.map((s) => ({
    value: s, label: s,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-background shadow-xl flex flex-col max-h-[85vh]">
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
          {safeEmployees.length > 0 && (
            <MultiSelectDropdown
              label="Assigned"
              options={assigneeOptions}
              selected={draft.assignees}
              onChange={(s) => setDraft((d) => ({ ...d, assignees: s }))}
            />
          )}
          <MultiSelectDropdown
            label="Source"
            options={sourceOptions}
            selected={draft.sources}
            onChange={(s) => setDraft((d) => ({ ...d, sources: s }))}
          />
          {safeImports.length > 0 && (
            <MultiSelectDropdown
              label="Batch"
              options={safeImports.map((b) => ({
                value: b.label,
                label: `${b.label} (${b.lead_count})`,
                dot: getBatchColor(b.color).bg,
              }))}
              selected={draft.batchLabels}
              onChange={(s) => setDraft((d) => ({ ...d, batchLabels: s }))}
            />
          )}
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
            onClick={() => setDraft({ statuses: new Set(), assignees: new Set(), sources: new Set(), batchLabels: new Set(), createdFrom: undefined, createdTo: undefined })}
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
    role,
    loadLeads,
    loadingLeads,
    checkedIds,
    setCheckedIds,
    setSelectedLead,
    setSelectedOrgId,
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
    const statusesParam  = searchParams.get("statuses");
    const assigneesParam = searchParams.get("assignees");
    const sourcesParam   = searchParams.get("sources");
    const batchesParam   = searchParams.get("batches");
    const fromParam      = searchParams.get("from");
    const toParam        = searchParams.get("to");
    return {
      statuses:    statusesParam  ? new Set(statusesParam.split(",") as LeadStatus[]) : new Set(),
      assignees:   assigneesParam ? new Set(assigneesParam.split(","))               : new Set(),
      sources:     sourcesParam   ? new Set(sourcesParam.split(",")  as LeadSource[]) : new Set(),
      batchLabels: batchesParam   ? new Set(batchesParam.split(","))                  : new Set(),
      createdFrom: fromParam ? new Date(fromParam) : undefined,
      createdTo:   toParam   ? new Date(toParam)   : undefined,
    };
  });
  const [showFilters,      setShowFilters     ] = useState(false);
  const [page,             setPage            ] = useState(1);
  const [pageSize,         setPageSize        ] = useState(50);
  const [importBatches,    setImportBatches   ] = useState<ImportBatch[]>([]);
  const [showBulkDelete,   setShowBulkDelete  ] = useState(false);
  const [bulkDeleting,     setBulkDeleting    ] = useState(false);
  const [showBulkAssign,   setShowBulkAssign  ] = useState(false);
  const [bulkAssigning,    setBulkAssigning   ] = useState(false);
  const [assignStrategy,   setAssignStrategy  ] = useState<BulkAssignStrategy>("manual");
  const [assignTarget,     setAssignTarget    ] = useState<string>("unassigned");
  const [assignOverwriteConfirmed, setAssignOverwriteConfirmed] = useState(false);
  const [assignSkipAssigned, setAssignSkipAssigned] = useState(false);
  const [employees,        setEmployees       ] = useState<Profile[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [retryingAll,      setRetryingAll     ] = useState(false);

  async function handleRetryAllFailed() {
    if (!session || retryingAll) return;
    setRetryingAll(true);
    try {
      const { requeued } = await retryAllFailedEnrichment(session.access_token);
      toast.success(requeued > 0 ? `Retrying enrichment for ${requeued} compan${requeued === 1 ? "y" : "ies"}…` : "Nothing left to retry.");
      setTimeout(() => { if (session) void loadLeads(session.access_token); }, 3000);
    } catch (e) {
      toast.error((e as Error).message || "Retry failed");
    } finally {
      setRetryingAll(false);
    }
  }

  useEffect(() => {
    if (role !== "manager" || !session) return;
    setEmployeesLoading(true);
    fetchUsers(session.access_token).then((users) => {
      setEmployees(users.filter((u) => u.role === "employee" && u.is_active));
    }).catch(() => {}).finally(() => setEmployeesLoading(false));
  }, [role, session]);

  // Sync filter/view state into URL so refresh preserves it
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery)                  params.set("q",        searchQuery);
    if (leadsSort !== "newest")       params.set("sort",     leadsSort);
    if (leadsViewMode !== "list")     params.set("view",     leadsViewMode);
    if (leadsEntityMode !== "individual") params.set("entity", leadsEntityMode);
    if (filters.statuses.size > 0)     params.set("statuses", [...filters.statuses].join(","));
    if (filters.assignees.size > 0)    params.set("assignees", [...filters.assignees].join(","));
    if (filters.sources.size  > 0)     params.set("sources",  [...filters.sources].join(","));
    if (filters.batchLabels.size > 0)  params.set("batches",  [...filters.batchLabels].join(","));
    if (filters.createdFrom)          params.set("from", filters.createdFrom.toISOString().slice(0, 10));
    if (filters.createdTo)            params.set("to",   filters.createdTo.toISOString().slice(0, 10));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchQuery, leadsSort, leadsViewMode, leadsEntityMode, filters, pathname, router]);

  // Reset to page 1 whenever the filtered result set changes
  useEffect(() => { setPage(1); }, [searchQuery, filters, leadsSort]);

  // Load leads only when visiting this page (not globally on every route).
  useEffect(() => {
    if (!session || loadingLeads) return;
    if (leads.length > 0) return;
    void loadLeads(session.access_token);
  }, [session, leads.length, loadingLeads, loadLeads]);

  // Background enrichment (email reveal, website scraping) keeps changing lead
  // status after this page's initial load, but nothing pushes those changes to
  // the browser — without this, the list/Kanban silently goes stale and looks
  // like data disappeared even though the database is fine. Poll quietly
  // while this page is open; skip a tick if a load is already in flight.
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      if (!loadingLeads) void loadLeads(session.access_token);
    }, 30_000);
    return () => clearInterval(interval);
  }, [session, loadingLeads, loadLeads]);

  // Fetch import batches for the batch filter dropdown; re-run when leads refresh
  useEffect(() => {
    if (!session) return;
    fetchImports(session.access_token)
      .then((r) => setImportBatches(r.imports))
      .catch(() => {});
  }, [session, leads]);

  const filteredLeads = sortLeads(
    leads.filter((l) => {
      if (filters.statuses.size > 0 && !filters.statuses.has(l.status)) return false;
      if (filters.assignees.size > 0) {
        const matchesAssignee = [...filters.assignees].some((v) =>
          v === UNASSIGNED_FILTER_VALUE ? !l.assignedTo : l.assignedTo === v
        );
        if (!matchesAssignee) return false;
      }
      if (filters.sources.size  > 0 && !filters.sources.has(l.source)) return false;
      if (filters.batchLabels.size > 0 && !filters.batchLabels.has(l.batchLabel ?? "")) return false;
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
  const checkedLeads = leads.filter((l) => checkedIds.has(l.id));
  const checkedCount = checkedLeads.length;
  const eligibleCheckedCount = checkedLeads.filter(isCampaignEligible).length;
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
        <div className="flex items-center gap-4 flex-wrap">
          <SegmentedTabs
            value={leadsEntityMode}
            onValueChange={setLeadsEntityMode}
            className="shrink-0"
            options={[
              { value: "individual", label: "Individual", icon: Users },
              { value: "orgs", label: "Organization", icon: Building2 },
            ]}
          />

          {role === "manager" && (
            <Button
              size="sm" variant="outline" className="gap-1.5 bg-card"
              disabled={checkedIds.size === 0}
              onClick={() => { if (checkedIds.size > 0) { setAssignOverwriteConfirmed(false); setAssignSkipAssigned(false); setShowBulkAssign(true); } }}
            >
              <UserPlus className="size-3.5" /> Assign{checkedIds.size > 0 ? ` (${checkedIds.size})` : ""}
            </Button>
          )}
          {someChecked && role === "manager" && (
            <Button
              size="sm" className="gap-1.5"
              disabled={!canCreateCampaign}
              title={!canCreateCampaign ? "Only enriched leads with a domain can be added to campaigns" : undefined}
              onClick={() => { setShowCreateCampaign(true); }}
            >
              <Megaphone className="size-3.5" /> Create campaign{eligibleCheckedCount > 0 ? ` (${eligibleCheckedCount})` : ""}
            </Button>
          )}
          {someChecked && (
            <button
              type="button"
              onClick={() => setCheckedIds(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {leadsEntityMode === "individual" && (
            <SegmentedTabs
              value={leadsViewMode}
              onValueChange={setLeadsViewMode}
              options={[
                { value: "list", label: "List", icon: List },
                { value: "kanban", label: "Kanban", icon: Kanban },
              ]}
            />
          )}
          <Button
            variant="outline" size="sm" className="gap-1.5"
            disabled={loadingLeads}
            onClick={() => session && loadLeads(session.access_token)}
          >
            <RefreshCw className={cn("size-3.5", loadingLeads && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => router.push("/leads/add")} className="gap-1.5">
            <Plus className="size-3.5" /> Add leads
          </Button>
        </div>
      </div>

      {/* Upstream credit/API-key failures (OpenRouter/Firecrawl/Apollo). */}
      <ServiceHealthBanner />

      {/* ── Search + Columns toolbar ── */}
      {leadsEntityMode === "individual" && leadsViewMode === "list" && (
        <div className="flex items-center gap-3 px-8 py-3 border-b border-border shrink-0">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search leads…"
            size="sm"
            wrapperClassName="flex-1 max-w-xs"
          />
          {someChecked && role === "manager" && (
            <Button
              size="sm" variant="destructive" className="gap-1.5 text-white!"
              onClick={() => { if (checkedIds.size > 0) setShowBulkDelete(true); }}
            >
              <Trash2 className="size-3.5" /> Delete ({checkedIds.size})
            </Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <Select value={leadsSort} onValueChange={(value) => setLeadsSort(value as LeadsSort)}>
              <SelectTrigger className="h-8 w-36 gap-2 rounded-md border-border px-3 text-xs shadow-sm">
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
                  ? "border-border bg-card text-muted-foreground hover:text-foreground hover:border-muted-foreground"
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
                        <TableCell colSpan={6} className="p-0">
                          <EmptyState boxed={false} message="No organizations found. Add leads with a domain to populate this view." />
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
          <KanbanBoard
            leads={leads}
            onCardClick={(lead) => setSelectedLead(lead)}
            onRetryAllFailed={role === "manager" ? handleRetryAllFailed : undefined}
            retryingAll={retryingAll}
          />
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-10 pl-4">
                    <AppCheckbox
                      checked={allEligibleChecked ? true : someChecked ? "indeterminate" : false}
                      onClick={toggleAll}
                    />
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
                  {visibleCols.assigned  && <TableHead className="text-xs font-semibold text-muted-foreground">Assigned</TableHead>}
                  {visibleCols.source    && <TableHead className="text-xs font-semibold text-muted-foreground">Source</TableHead>}
                  {visibleCols.domain    && <TableHead className="text-xs font-semibold text-muted-foreground">Domain</TableHead>}
                  {visibleCols.country   && <TableHead className="text-xs font-semibold text-muted-foreground">Country</TableHead>}
                  {visibleCols.campaign  && <TableHead className="text-xs font-semibold text-muted-foreground">Campaign</TableHead>}
                  {visibleCols.batch     && <TableHead className="text-xs font-semibold text-muted-foreground">Batch</TableHead>}
                  {visibleCols.added     && <TableHead className="text-xs font-semibold text-muted-foreground">Added</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedLeads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="p-0">
                      <EmptyState
                        boxed={false}
                        message={searchQuery ? `No leads match "${searchQuery}".` : "No leads yet. Click \"Add leads\" to get started."}
                      />
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
                        <TableCell
                          className="pl-4"
                          onClick={(e) => {
                            // Ineligible (still-enriching) leads must not be
                            // selectable — the disabled checkbox alone left the
                            // cell click as a loophole to select them.
                            e.stopPropagation();
                            if (eligible) toggleOne(lead.id, e);
                          }}
                        >
                          <AppCheckbox
                            checked={isChecked && eligible}
                            disabled={!eligible}
                            title={ineligibleReason ?? undefined}
                          />
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
                        {visibleCols.assigned  && (
                          <TableCell>
                            {lead.assignedTo ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                                <User className="size-3 text-muted-foreground shrink-0" />
                                {assigneeDisplayName(lead.assignedTo, session, employees)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/25">
                                Unassigned
                              </span>
                            )}
                          </TableCell>
                        )}
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
                        {visibleCols.batch && (
                          <TableCell>
                            {lead.batchLabel ? (() => {
                              const bc = getBatchColor(lead.batchColor ?? "violet");
                              return (
                                <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium whitespace-nowrap", bc.pill)}>
                                  {lead.batchLabel}
                                </span>
                              );
                            })() : <span className="text-xs text-muted-foreground">—</span>}
                          </TableCell>
                        )}
                        {visibleCols.added     && <TableCell><span className="text-xs text-muted-foreground">{lead.createdAt.slice(0, 10)}</span></TableCell>}
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
          imports={importBatches}
          employees={employees}
        />
      )}

      {/* Bulk delete confirmation modal */}
      <ConfirmDialog
        open={showBulkDelete}
        title={`Delete ${checkedIds.size} lead${checkedIds.size !== 1 ? "s" : ""}?`}
        description="This will permanently remove the selected leads. This cannot be undone."
        loading={bulkDeleting}
        confirmDisabled={!session}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={async () => {
          if (!session) return;
          setBulkDeleting(true);
          try {
            await bulkDeleteLeads(session.access_token, [...checkedIds]);
            setCheckedIds(new Set());
            setShowBulkDelete(false);
            void loadLeads(session.access_token);
          } catch (e) {
            console.error("Bulk delete failed:", e);
          } finally {
            setBulkDeleting(false);
          }
        }}
      />

      {/* Bulk assign modal */}
      {showBulkAssign && (() => {
        const alreadyAssignedCount = leads.filter((l) => checkedIds.has(l.id) && l.assignedTo).length;
        // With "skip already assigned" on, nothing gets overwritten, so no
        // reassignment confirmation is needed (spec §4).
        const needsOverwriteConfirm = alreadyAssignedCount > 0 && !assignSkipAssigned && !assignOverwriteConfirmed;
        return (
        <div className="fixed inset-0 z-200 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!bulkAssigning) setShowBulkAssign(false); }} />
          <div className="relative z-10 w-full max-w-sm mx-4 rounded-2xl border border-border bg-card shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex items-start gap-4">
              <div className="shrink-0 size-10 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center">
                <UserPlus className="size-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">Assign {checkedIds.size} lead{checkedIds.size !== 1 ? "s" : ""}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">Choose how these leads should be routed to employees.</p>
              </div>
            </div>

            <div className="grid gap-2">
              {ASSIGN_STRATEGIES.map((s) => (
                <label
                  key={s.value}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-secondary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="assign-strategy"
                    className="mt-1"
                    checked={assignStrategy === s.value}
                    onChange={() => setAssignStrategy(s.value)}
                  />
                  <div>
                    <p className="text-sm font-medium">{s.label}</p>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  </div>
                </label>
              ))}
            </div>

            {assignStrategy === "manual" && (
              employeesLoading ? (
                <div className="h-10 rounded-md border border-border bg-secondary/40 animate-pulse" />
              ) : (
                <Select value={assignTarget} onValueChange={setAssignTarget}>
                  <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent className="z-300">
                    <SelectItem value="unassigned">Unassigned (pool)</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.full_name || e.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            )}

            {alreadyAssignedCount > 0 && (
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 text-xs cursor-pointer hover:bg-secondary/40">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={assignSkipAssigned}
                    onChange={(e) => setAssignSkipAssigned(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium text-foreground">Skip already assigned leads</span>
                    <br />
                    <span className="text-muted-foreground">Leave the {alreadyAssignedCount} already-owned {alreadyAssignedCount !== 1 ? "leads" : "lead"} untouched and only assign the rest.</span>
                  </span>
                </label>
                {!assignSkipAssigned && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                    {alreadyAssignedCount} of these {alreadyAssignedCount !== 1 ? "leads are" : "lead is"} already assigned to someone else — proceeding will reassign {alreadyAssignedCount !== 1 ? "them" : "it"}.
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBulkAssign(false)}
                disabled={bulkAssigning}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkAssigning || !session || (assignStrategy === "manual" && employeesLoading)}
                onClick={async () => {
                  if (needsOverwriteConfirm) {
                    setAssignOverwriteConfirmed(true);
                    return;
                  }
                  if (!session) return;
                  setBulkAssigning(true);
                  try {
                    const summary: AssignmentSummary = await bulkAssignLeads(
                      session.access_token,
                      [...checkedIds],
                      assignStrategy,
                      assignStrategy === "manual" ? (assignTarget === "unassigned" ? null : assignTarget) : undefined,
                      assignSkipAssigned,
                    );
                    setCheckedIds(new Set());
                    setShowBulkAssign(false);
                    void loadLeads(session.access_token);

                    // Summarise the result (spec §3): what moved, what was skipped,
                    // and any offline/unmatched caveats.
                    const parts: string[] = [];
                    if (summary.newly_assigned) parts.push(`${summary.newly_assigned} assigned`);
                    if (summary.reassigned) parts.push(`${summary.reassigned} reassigned`);
                    if (summary.skipped_already_assigned) parts.push(`${summary.skipped_already_assigned} skipped (already owned)`);
                    if (summary.skipped_not_ready) parts.push(`${summary.skipped_not_ready} skipped (still enriching)`);
                    if (summary.unmatched) parts.push(`${summary.unmatched} left unassigned (no eligible employee)`);
                    toast.success(parts.length ? parts.join(" · ") : "No changes");
                    if (summary.skipped_not_ready) {
                      toast.warning(`${summary.skipped_not_ready} lead${summary.skipped_not_ready === 1 ? "" : "s"} still being enriched — they'll be assignable once ready.`);
                    }
                    if (summary.manual_target_offline) {
                      toast.warning("Heads up: that employee is currently marked offline (away).");
                    }
                    if (summary.excluded_offline > 0 && assignStrategy !== "manual") {
                      toast.message(`${summary.excluded_offline} offline employee${summary.excluded_offline !== 1 ? "s were" : " was"} excluded from routing.`);
                    }
                  } catch (e) {
                    toast.error((e as Error).message || "Bulk assign failed");
                  } finally {
                    setBulkAssigning(false);
                  }
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {bulkAssigning ? <RefreshCw className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
                {needsOverwriteConfirm ? "Reassign anyway" : "Assign"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
