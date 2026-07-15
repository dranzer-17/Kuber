"use client";

import { Info, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead, LeadStatus } from "@/lib/leads";
import { kanbanColumnFor, inputRequiredReason } from "@/lib/leads";

const KANBAN_COLS: { id: LeadStatus; label: string; hint?: string; dot: string; header: string }[] = [
  { id: "New",            label: "New",            hint: "Enrichment in progress", dot: "bg-zinc-400",   header: "border-zinc-500/30"   },
  { id: "Input Required", label: "Input Required", hint: "Enrichment concluded — needs attention", dot: "bg-yellow-400", header: "border-yellow-500/30" },
  { id: "Enriched",       label: "Enriched",       dot: "bg-blue-400",   header: "border-blue-500/30"   },
  { id: "Open",           label: "Win",            dot: "bg-green-400",  header: "border-green-500/30"  },
  { id: "Closed",         label: "Closed",         dot: "bg-zinc-400",   header: "border-zinc-500/30"   },
];

export function KanbanBoard({
  leads,
  onCardClick,
  onRetryAllFailed,
  retryingAll,
}: {
  leads: Lead[];
  onCardClick: (lead: Lead) => void;
  /** Manager-only bulk retry for the "failed website" flavour of Input Required. Omit to hide the action. */
  onRetryAllFailed?: () => void;
  retryingAll?: boolean;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-4 min-h-[500px]">
      {KANBAN_COLS.map((col) => {
        const colLeads = leads.filter((l) => kanbanColumnFor(l) === col.id);
        const failedCount = col.id === "Input Required"
          ? colLeads.filter((l) => inputRequiredReason(l) === "failed").length
          : 0;
        return (
          <div
            key={col.id}
            className="shrink-0 flex flex-col gap-2"
            style={{ width: "calc((100% - 32px) / 5)", minWidth: "160px" }}
          >
            <div className={cn("flex items-center gap-1.5 px-2.5 py-2 rounded-lg border bg-card", col.header)} title={col.hint}>
              <span className={cn("size-2 rounded-full shrink-0", col.dot)} />
              <span className="text-xs font-semibold truncate">{col.label}</span>
              {col.id === "Input Required" && onRetryAllFailed && failedCount > 0 && (
                <button
                  type="button"
                  onClick={onRetryAllFailed}
                  disabled={retryingAll}
                  title="Retry enrichment for every failed company in this list"
                  className="ml-auto shrink-0 flex items-center gap-1 text-[10px] font-medium text-yellow-500 hover:text-yellow-400 disabled:opacity-50 transition-colors"
                >
                  <RotateCcw className={cn("size-3", retryingAll && "animate-spin")} />
                  Retry all
                </button>
              )}
              <span className={cn("text-[10px] font-medium text-muted-foreground bg-secondary rounded-full px-1.5 py-0.5 tabular-nums shrink-0", !(col.id === "Input Required" && onRetryAllFailed && failedCount > 0) && "ml-auto")}>
                {colLeads.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {colLeads.map((lead) => {
                const reason = inputRequiredReason(lead);
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => onCardClick(lead)}
                    className={cn(
                      "rounded-lg border bg-card p-2.5 text-left cursor-pointer hover:border-muted-foreground/50 transition-colors shadow-sm relative",
                      reason === "failed" ? "border-yellow-500/40" : reason === "missing_data" ? "border-red-500/30" : "border-border",
                    )}
                    title={reason === "failed" && lead.lastError ? lead.lastError : undefined}
                  >
                    {reason === "missing_data" && (
                      <span title="No email found — add one before this lead can be contacted" className="absolute top-2 right-2 text-red-400">
                        <Info className="size-3" />
                      </span>
                    )}
                    {reason === "failed" && (
                      <span title="No usable website — campaigns will use the generic template. Open to retry enrichment." className="absolute top-2 right-2 text-yellow-400">
                        <RotateCcw className="size-3" />
                      </span>
                    )}
                    <p className="text-xs font-semibold truncate mb-0.5 pr-4">
                      {lead.firstName} {lead.lastName}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate mb-2">{lead.company}</p>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] text-muted-foreground/60 truncate">
                        {reason === "failed"
                          ? "No website — generic template"
                          : reason === "missing_data"
                          ? "Needs email"
                          : lead.jobTitle}
                      </span>
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
