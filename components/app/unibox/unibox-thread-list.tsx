"use client";

import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UniboxThreadSummary } from "@/lib/api-client";

type Props = {
  tab: "primary" | "others";
  threads: UniboxThreadSummary[];
  selectedId: string | null;
  search: string;
  loading: boolean;
  onTab: (t: "primary" | "others") => void;
  onSearch: (q: string) => void;
  onSelect: (threadId: string) => void;
  onLoadMore?: () => void;
  hasMore: boolean;
};

export function UniboxThreadList({
  tab, threads, selectedId, search, loading, onTab, onSearch, onSelect, onLoadMore, hasMore,
}: Props) {
  return (
    <div className="w-[380px] shrink-0 border-r border-border flex flex-col bg-card/30">
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {(["primary", "others"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTab(t)}
              className={cn(
                "flex-1 py-1.5 text-xs font-medium rounded-md capitalize",
                tab === t ? "bg-primary/15 text-primary" : "text-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search mail…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full h-8 px-3 rounded-md border border-border bg-background text-xs"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading && threads.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : threads.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-12 px-4">No conversations yet — replies will appear here after sync.</p>
        ) : (
          threads.map((t) => {
            const name = [t.lead?.first_name, t.lead?.last_name].filter(Boolean).join(" ") || t.lead_email || "Unknown";
            return (
              <button
                key={t.thread_id}
                type="button"
                onClick={() => onSelect(t.thread_id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 rounded-lg border transition-colors",
                  selectedId === t.thread_id
                    ? "bg-primary/10 border-primary/30"
                    : "border-transparent hover:bg-secondary/60",
                  t.unread_count > 0 && "font-semibold",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm truncate">{name}</p>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {format(new Date(t.latest_at), "MMM d")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{t.subject ?? "(no subject)"}</p>
                <p className="text-[10px] text-muted-foreground/80 line-clamp-2 mt-1">{t.preview}</p>
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
