"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Loader2, Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UniboxThreadSummary } from "@/lib/api-client";
import type { UniboxInterestFilter, UniboxReadStateFilter } from "@/components/app/unibox/unibox-status-filter";
import { hasActiveUniboxFilters, UniboxFiltersPanel } from "@/components/app/unibox/unibox-filters";

type Props = {
  threads: UniboxThreadSummary[];
  selectedId: string | null;
  search: string;
  loading: boolean;
  readState: UniboxReadStateFilter;
  interest: UniboxInterestFilter;
  unreadTotal: number;
  campaignIds: string[];
  campaigns: Array<{ id: string; name: string }>;
  eaccount: string | null;
  eaccounts: string[];
  onCampaigns: (ids: string[]) => void;
  onEaccount: (e: string | null) => void;
  onReadState: (v: UniboxReadStateFilter) => void;
  onInterest: (v: UniboxInterestFilter) => void;
  onSearch: (q: string) => void;
  onSelect: (threadId: string) => void;
  onLoadMore?: () => void;
  hasMore: boolean;
};

export function UniboxThreadList({
  threads, selectedId, search, loading, readState, interest, unreadTotal,
  campaignIds, campaigns, eaccount, eaccounts, onCampaigns, onEaccount,
  onReadState, onInterest, onSearch, onSelect, onLoadMore, hasMore,
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersActive = hasActiveUniboxFilters(campaignIds, eaccount, readState, interest);

  return (
    <div className="w-full h-full flex">
      <div
        className={cn(
          "shrink-0 border-r border-border bg-card/60 overflow-hidden transition-[width] duration-200",
          filtersOpen ? "w-72" : "w-0",
        )}
      >
        <div className="w-72 h-full">
          <UniboxFiltersPanel
            campaigns={campaigns}
            campaignIds={campaignIds}
            onCampaigns={onCampaigns}
            eaccount={eaccount}
            eaccounts={eaccounts}
            onEaccount={onEaccount}
            readState={readState}
            onReadState={onReadState}
            interest={interest}
            onInterest={onInterest}
            unreadTotal={unreadTotal}
            onClose={() => setFiltersOpen(false)}
          />
        </div>
      </div>

      <div className="flex-1 min-w-0 h-full flex flex-col bg-background">
        <div className="px-6 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-label={filtersOpen ? "Close filters" : "Open filters"}
              className={cn(
                "relative shrink-0 size-10 flex items-center justify-center rounded-full text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors",
                filtersActive && "text-primary",
              )}
            >
              <Menu className="size-5" />
              {filtersActive && <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-card" />}
            </button>
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search by lead name…"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                className="w-full h-10 pl-9 pr-4 rounded-full border-none bg-secondary/40 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && threads.length === 0 ? (
            <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : threads.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-12 px-6">No conversations match your filters.</p>
          ) : (
            threads.map((t) => {
              const name = [t.lead?.first_name, t.lead?.last_name].filter(Boolean).join(" ") || t.lead_email || "Unknown";
              const needsReply = t.latest_direction === "received";
              const isUnread = t.unread_count > 0;
              return (
                <button
                  key={t.thread_id}
                  type="button"
                  onClick={() => onSelect(t.thread_id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-6 py-2.5 border-b border-border text-left transition-colors",
                    selectedId === t.thread_id ? "bg-primary/5" : "bg-card hover:bg-secondary/40",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-1.5 rounded-full shrink-0", needsReply ? "bg-amber-500" : "bg-transparent")}
                  />
                  <span className={cn("w-44 shrink-0 truncate text-sm", isUnread ? "font-semibold text-foreground" : "text-foreground/80")}>
                    {name}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-sm">
                    <span className={isUnread ? "font-semibold text-foreground" : "text-foreground/80"}>
                      {t.subject ?? "(no subject)"}
                    </span>
                    <span className="text-muted-foreground"> — {t.preview}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {isUnread && t.unread_count > 1 && (
                      <span className="text-[9px] font-semibold tabular-nums min-w-4 text-center px-1 py-0.5 rounded-full bg-primary/15 text-primary">
                        {t.unread_count}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground w-14 text-right">
                      {format(new Date(t.latest_at), "MMM d")}
                    </span>
                  </span>
                </button>
              );
            })
          )}
          {hasMore && (
            <button type="button" onClick={onLoadMore} className="w-full py-2.5 text-xs text-primary hover:underline">
              Load more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
