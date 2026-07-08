"use client";

import { useMemo, useState } from "react";
import { ChevronDown, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  INTEREST_FILTER_OPTIONS,
  READ_STATE_OPTIONS,
  type UniboxInterestFilter,
  type UniboxReadStateFilter,
} from "@/components/app/unibox/unibox-status-filter";

const rowClass = (active: boolean) =>
  cn(
    "w-full flex items-center gap-3 px-3.5 py-2 rounded-full text-sm text-left transition-colors",
    active ? "bg-primary/15 text-primary font-semibold" : "text-foreground/80 hover:bg-secondary/50",
  );

const sectionLabelClass = "px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-2";

/** Whether any filter is currently applied — used for the toggle button's active-dot badge. */
export function hasActiveUniboxFilters(
  campaignIds: string[],
  eaccount: string | null,
  readState: UniboxReadStateFilter,
  interest: UniboxInterestFilter,
): boolean {
  return campaignIds.length > 0 || !!eaccount || readState !== "all" || interest !== "all";
}

/** Collapsed-by-default dropdown: a summary trigger row that expands to reveal search + a bounded scrollable list. Scales to long lists (campaigns, inboxes) without ballooning the panel. */
function FilterDropdown({
  label, summary, expanded, onToggle, children,
}: {
  label: string; summary: string; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div>
      <p className={sectionLabelClass}>{label}</p>
      <div className="px-2">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center justify-between gap-2 h-9 px-3.5 rounded-lg border border-border bg-background text-sm hover:bg-secondary/40 transition-colors"
        >
          <span className="truncate text-foreground/80">{summary}</span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
        </button>
      </div>
      {expanded && <div className="pt-1.5">{children}</div>}
    </div>
  );
}

/**
 * In-flow filter panel content — meant to be placed as a normal flex sibling inside a
 * fixed-width collapsible column (no fixed/overlay positioning), so it pushes the thread
 * list over instead of covering the app's main nav.
 */
export function UniboxFiltersPanel({
  campaigns,
  campaignIds,
  onCampaigns,
  eaccount,
  eaccounts,
  onEaccount,
  readState,
  onReadState,
  interest,
  onInterest,
  unreadTotal,
  onClose,
}: {
  campaigns: Array<{ id: string; name: string }>;
  campaignIds: string[];
  onCampaigns: (ids: string[]) => void;
  eaccount: string | null;
  eaccounts: string[];
  onEaccount: (e: string | null) => void;
  readState: UniboxReadStateFilter;
  onReadState: (v: UniboxReadStateFilter) => void;
  interest: UniboxInterestFilter;
  onInterest: (v: UniboxInterestFilter) => void;
  unreadTotal: number;
  onClose: () => void;
}) {
  const [campaignsExpanded, setCampaignsExpanded] = useState(false);
  const [inboxExpanded, setInboxExpanded] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [inboxSearch, setInboxSearch] = useState("");

  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter((c) => c.name.toLowerCase().includes(q));
  }, [campaigns, campaignSearch]);

  const filteredEaccounts = useMemo(() => {
    const q = inboxSearch.trim().toLowerCase();
    if (!q) return eaccounts;
    return eaccounts.filter((e) => e.toLowerCase().includes(q));
  }, [eaccounts, inboxSearch]);

  function toggleCampaign(id: string) {
    if (campaignIds.includes(id)) onCampaigns(campaignIds.filter((x) => x !== id));
    else onCampaigns([...campaignIds, id]);
  }

  const active = hasActiveUniboxFilters(campaignIds, eaccount, readState, interest);

  function clearAll() {
    onCampaigns([]);
    onEaccount(null);
    onReadState("all");
    onInterest("all");
  }

  const campaignSummary = campaignIds.length === 0
    ? "All campaigns"
    : campaignIds.length === 1
      ? (campaigns.find((c) => c.id === campaignIds[0])?.name ?? "1 campaign")
      : `${campaignIds.length} campaigns selected`;

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
        <p className="text-sm font-semibold">Filters</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="size-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {/* Read state (mailbox-level: have you read it?) and Instantly status (CRM-level: is the lead
            interested?) are independent dimensions of a conversation — a thread can be both Unread AND
            Interested at once, so these are selected independently, not mutually exclusive. */}
        <p className={sectionLabelClass}>Conversations</p>
        <div className="px-2 space-y-0.5">
          {READ_STATE_OPTIONS.map((o) => (
            <button key={o.value} type="button" onClick={() => onReadState(o.value)} className={rowClass(readState === o.value)}>
              <span className="flex-1 truncate">{o.label}</span>
              {o.value === "unread" && unreadTotal > 0 && <span className="text-[11px] tabular-nums">{unreadTotal}</span>}
            </button>
          ))}
        </div>

        <p className={sectionLabelClass}>Instantly status</p>
        <div className="px-2 space-y-0.5">
          <button type="button" onClick={() => onInterest("all")} className={rowClass(interest === "all")}>
            All statuses
          </button>
          {INTEREST_FILTER_OPTIONS.map((o) => (
            <button key={o.label} type="button" onClick={() => onInterest(o.value)} className={rowClass(interest === o.value)}>
              <Zap className={cn("size-3.5 shrink-0", o.color)} />
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>

        <FilterDropdown
          label="Campaigns"
          summary={campaignSummary}
          expanded={campaignsExpanded}
          onToggle={() => setCampaignsExpanded((v) => !v)}
        >
          <div className="px-4 pb-1.5">
            <input
              type="search"
              value={campaignSearch}
              onChange={(e) => setCampaignSearch(e.target.value)}
              placeholder="Search campaigns…"
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-xs"
            />
          </div>
          <div className="px-2 space-y-0.5 max-h-48 overflow-y-auto">
            {filteredCampaigns.map((c) => {
              const checked = campaignIds.includes(c.id);
              return (
                <label key={c.id} className={cn(rowClass(checked), "cursor-pointer")}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCampaign(c.id)}
                    className="size-3.5 rounded border-border accent-primary shrink-0"
                  />
                  <span className="truncate">{c.name}</span>
                </label>
              );
            })}
            {filteredCampaigns.length === 0 && <p className="text-xs text-muted-foreground text-center py-3">No matches</p>}
          </div>
        </FilterDropdown>

        <FilterDropdown
          label="Inbox accounts"
          summary={eaccount ?? "All inboxes"}
          expanded={inboxExpanded}
          onToggle={() => setInboxExpanded((v) => !v)}
        >
          <div className="px-4 pb-1.5">
            <input
              type="search"
              value={inboxSearch}
              onChange={(e) => setInboxSearch(e.target.value)}
              placeholder="Search inboxes…"
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-xs"
            />
          </div>
          <div className="px-2 space-y-0.5 pb-1 max-h-48 overflow-y-auto">
            <button type="button" onClick={() => onEaccount(null)} className={rowClass(!eaccount)}>
              All inboxes
            </button>
            {filteredEaccounts.map((e) => (
              <button key={e} type="button" onClick={() => onEaccount(e)} className={cn(rowClass(eaccount === e), "truncate")}>
                {e}
              </button>
            ))}
          </div>
        </FilterDropdown>
      </div>

      <div className="px-4 py-3 border-t border-border shrink-0">
        <button
          type="button"
          onClick={clearAll}
          disabled={!active}
          className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed py-2 rounded-md hover:bg-secondary/50 transition-colors"
        >
          Clear all filters
        </button>
      </div>
    </div>
  );
}
