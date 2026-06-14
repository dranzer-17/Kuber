"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead, LeadStatus } from "@/lib/leads";
import { kanbanColumnFor } from "@/lib/leads";

const KANBAN_COLS: { id: LeadStatus; label: string; dot: string; header: string }[] = [
  { id: "New",         label: "New",         dot: "bg-zinc-400",   header: "border-zinc-500/30"   },
  { id: "Enriching",   label: "Enriching",   dot: "bg-amber-400",  header: "border-amber-500/30"  },
  { id: "Enriched",    label: "Enriched",    dot: "bg-blue-400",   header: "border-blue-500/30"   },
  { id: "Draft Ready", label: "Draft Ready", dot: "bg-violet-400", header: "border-violet-500/30" },
  { id: "Approved",    label: "Approved",    dot: "bg-cyan-400",   header: "border-cyan-500/30"   },
  { id: "Won",         label: "Won",         dot: "bg-green-400",  header: "border-green-500/30"  },
  { id: "Closed",      label: "Closed",      dot: "bg-zinc-400",   header: "border-zinc-500/30"   },
];

export function KanbanBoard({
  leads,
  onCardClick,
}: {
  leads: Lead[];
  onCardClick: (lead: Lead) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-4 min-h-[500px]">
      {KANBAN_COLS.map((col) => {
        const colLeads = leads.filter((l) => kanbanColumnFor(l) === col.id);
        return (
          <div
            key={col.id}
            className="shrink-0 flex flex-col gap-2"
            style={{ width: "calc((100% - 48px) / 7)", minWidth: "140px" }}
          >
            <div className={cn("flex items-center gap-1.5 px-2.5 py-2 rounded-lg border bg-card", col.header)}>
              <span className={cn("size-2 rounded-full shrink-0", col.dot)} />
              <span className="text-xs font-semibold truncate">{col.label}</span>
              <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-secondary rounded-full px-1.5 py-0.5 tabular-nums shrink-0">
                {colLeads.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {colLeads.map((lead) => {
                const failed = lead.enrichmentStage === "failed";
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => onCardClick(lead)}
                    className={cn(
                      "rounded-lg border bg-card p-2.5 text-left cursor-pointer hover:border-muted-foreground/50 transition-colors shadow-sm relative",
                      failed ? "border-red-500/50" : "border-border",
                    )}
                    title={failed && lead.lastError ? lead.lastError : undefined}
                  >
                    {failed && (
                      <AlertCircle className="size-3 text-red-400 absolute top-2 right-2" />
                    )}
                    <p className="text-xs font-semibold truncate mb-0.5 pr-4">
                      {lead.firstName} {lead.lastName}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate mb-2">{lead.company}</p>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] text-muted-foreground/60 truncate">{lead.jobTitle}</span>
                      {lead.score !== "—" && (
                        <span
                          className={cn(
                            "text-[9px] font-bold px-1 py-0.5 rounded shrink-0",
                            lead.score === "Hot"
                              ? "bg-orange-500/15 text-orange-400"
                              : "bg-blue-500/15 text-blue-400"
                          )}
                        >
                          {lead.score}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {colLeads.length === 0 && (
                <div className="rounded-lg border border-dashed border-border py-6 flex items-center justify-center">
                  <p className="text-[10px] text-muted-foreground/40">Empty</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
