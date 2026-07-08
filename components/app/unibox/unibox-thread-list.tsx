"use client";

import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UniboxThreadSummary } from "@/lib/api-client";
import {
  UniboxInboxFilter,
  UniboxInterestFilterDropdown,
  type UniboxInterestFilter,
  type UniboxReadStateFilter,
} from "@/components/app/unibox/unibox-status-filter";
import { CampaignMultiSelect, InboxSelect } from "@/components/app/unibox/unibox-filters";

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
  return (
    <div className="w-[380px] shrink-0 border-r border-border flex flex-col bg-card/30">
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-end gap-1.5">
          <CampaignMultiSelect items={campaigns} selectedIds={campaignIds} onChange={onCampaigns} />
          <InboxSelect eaccount={eaccount} eaccounts={eaccounts} onEaccount={onEaccount} />
        </div>
        <div className="flex items-center gap-1.5">
          <UniboxInboxFilter
            readState={readState}
            unreadTotal={unreadTotal}
            onReadState={onReadState}
          />
          <UniboxInterestFilterDropdown
            interest={interest}
            onInterest={onInterest}
          />
        </div>
        <input
          type="search"
          placeholder="Search by lead name…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full h-8 px-3 rounded-md border border-border bg-card text-xs"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && threads.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : threads.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-12 px-4">No conversations match your filters.</p>
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
                  "w-full text-left px-3 py-2.5 rounded-lg border transition-colors relative",
                  selectedId === t.thread_id
                    ? "bg-primary/10 border-primary/30"
                    : "border-transparent hover:bg-secondary/60",
                  isUnread && "border-l-2 border-l-primary bg-primary/5 font-semibold",
                )}
              >
                {isUnread && (
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 size-2 rounded-full bg-primary" />
                )}
                <div className={cn("flex items-center justify-between gap-2", isUnread && "pl-3")}>
                  <p className="text-sm truncate">{name}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {needsReply && (
                      <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/25">
                        Reply
                      </span>
                    )}
                    {isUnread && (
                      <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/25">
                        Unread
                      </span>
                    )}
                    {isUnread && t.unread_count > 1 && (
                      <span className="text-[9px] font-semibold tabular-nums min-w-4 text-center px-1 py-0.5 rounded-full bg-primary/15 text-primary">
                        {t.unread_count}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(t.latest_at), "MMM d")}
                    </span>
                  </div>
                </div>
                <p className={cn("text-xs text-muted-foreground truncate mt-0.5", isUnread && "pl-3")}>{t.subject ?? "(no subject)"}</p>
                <p className={cn("text-[10px] text-muted-foreground/80 line-clamp-2 mt-1", isUnread && "pl-3")}>{t.preview}</p>
              </button>
            );
          })
        )}
        {hasMore && (
          <button type="button" onClick={onLoadMore} className="w-full py-2 text-xs text-primary hover:underline">
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
