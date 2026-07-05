"use client";

import { cn } from "@/lib/utils";
import type { UniboxStatusFilter } from "@/lib/services/unibox";

const STATUS_ITEMS: { id: UniboxStatusFilter | null; label: string; color: string }[] = [
  { id: "lead", label: "Lead", color: "text-green-400" },
  { id: "interested", label: "Interested", color: "text-teal-400" },
  { id: "meeting_booked", label: "Meeting booked", color: "text-purple-400" },
  { id: "meeting_completed", label: "Meeting completed", color: "text-orange-400" },
  { id: "won", label: "Won", color: "text-yellow-400" },
];

const MORE_ITEMS: { id: UniboxStatusFilter; label: string }[] = [
  { id: "not_interested", label: "Not interested" },
  { id: "wrong_person", label: "Wrong person" },
  { id: "lost", label: "Lost" },
  { id: "ooo", label: "Out of office" },
];

type Props = {
  status: UniboxStatusFilter | null;
  campaignId: string | null;
  eaccount: string | null;
  counts: Record<string, number>;
  campaigns: Array<{ id: string; name: string }>;
  eaccounts: string[];
  onStatus: (s: UniboxStatusFilter | null) => void;
  onCampaign: (id: string | null) => void;
  onEaccount: (e: string | null) => void;
};

export function UniboxFilterRail({
  status, campaignId, eaccount, counts, campaigns, eaccounts, onStatus, onCampaign, onEaccount,
}: Props) {
  return (
    <div className="w-60 shrink-0 border-r border-border bg-card/40 p-3 space-y-4 overflow-y-auto">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Status</p>
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => onStatus(null)}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded-md text-xs",
              !status ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          {STATUS_ITEMS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onStatus(s.id)}
              className={cn(
                "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs",
                status === s.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className={s.color}>{s.label}</span>
              <span className="tabular-nums text-[10px]">{counts[s.id!] ?? 0}</span>
            </button>
          ))}
        </div>
        <details className="mt-2">
          <summary className="text-[10px] text-muted-foreground cursor-pointer px-2">More…</summary>
          <div className="mt-1 space-y-0.5">
            {MORE_ITEMS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onStatus(s.id)}
                className={cn(
                  "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs",
                  status === s.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
                <span className="tabular-nums text-[10px]">{counts[s.id] ?? 0}</span>
              </button>
            ))}
          </div>
        </details>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Campaigns</p>
        <button
          type="button"
          onClick={() => onCampaign(null)}
          className={cn("w-full text-left px-2 py-1.5 rounded-md text-xs mb-1", !campaignId ? "bg-primary/15 text-primary" : "text-muted-foreground")}
        >
          All campaigns
        </button>
        {campaigns.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onCampaign(c.id)}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded-md text-xs truncate",
              campaignId === c.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Inboxes</p>
        <button
          type="button"
          onClick={() => onEaccount(null)}
          className={cn("w-full text-left px-2 py-1.5 rounded-md text-xs mb-1", !eaccount ? "bg-primary/15 text-primary" : "text-muted-foreground")}
        >
          All inboxes
        </button>
        {eaccounts.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onEaccount(e)}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded-md text-xs truncate",
              eaccount === e ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
