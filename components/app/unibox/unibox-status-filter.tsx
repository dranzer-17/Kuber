"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type UniboxReadStateFilter = "all" | "unread" | "read" | "replied" | "needs_reply";
export type UniboxInterestFilter = "all" | "lead" | number;

export const READ_STATE_OPTIONS: { value: UniboxReadStateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
  { value: "replied", label: "Replied" },
  { value: "needs_reply", label: "Needs reply" },
];

export const INTEREST_FILTER_OPTIONS: { value: UniboxInterestFilter; label: string; color: string }[] = [
  { value: "lead", label: "Lead", color: "text-muted-foreground" },
  { value: 1, label: "Interested", color: "text-green-500" },
  { value: 2, label: "Meeting booked", color: "text-purple-500" },
  { value: 3, label: "Meeting completed", color: "text-orange-500" },
  { value: 4, label: "Won", color: "text-lime-500" },
  { value: 0, label: "Out of office", color: "text-blue-500" },
  { value: -1, label: "Not interested", color: "text-red-400" },
  { value: -2, label: "Wrong person", color: "text-slate-400" },
  { value: -3, label: "Lost", color: "text-rose-500" },
];

function interestLabel(value: UniboxInterestFilter): string {
  if (value === "all") return "All statuses";
  if (value === "lead") return "Lead";
  return INTEREST_FILTER_OPTIONS.find((o) => o.value === value)?.label ?? "Status";
}

function readStateLabel(value: UniboxReadStateFilter): string {
  return READ_STATE_OPTIONS.find((o) => o.value === value)?.label ?? "All";
}

type Props = {
  readState: UniboxReadStateFilter;
  interest: UniboxInterestFilter;
  unreadTotal: number;
  onReadState: (v: UniboxReadStateFilter) => void;
  onInterest: (v: UniboxInterestFilter) => void;
};

export function UniboxStatusFilter({
  readState, interest, unreadTotal, onReadState, onInterest,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const triggerLabel = useMemo(() => {
    if (interest !== "all") return interestLabel(interest);
    if (readState !== "all") return readStateLabel(readState);
    return "All conversations";
  }, [readState, interest]);

  const filteredInterest = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return INTEREST_FILTER_OPTIONS;
    return INTEREST_FILTER_OPTIONS.filter((o) => o.label.toLowerCase().includes(q));
  }, [search]);

  function selectRead(v: UniboxReadStateFilter) {
    onReadState(v);
    if (v !== "all") onInterest("all");
    setOpen(false);
    setSearch("");
  }

  function selectInterest(v: UniboxInterestFilter) {
    onInterest(v);
    if (v !== "all") onReadState("all");
    setOpen(false);
    setSearch("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between gap-2 h-9 px-3 rounded-lg border border-border bg-card text-sm font-medium hover:bg-secondary/40 transition-colors"
        >
          <span className="truncate flex items-center gap-2">
            {interest !== "all" && interest !== "lead" && (
              <Zap className={cn("size-3.5 shrink-0", INTEREST_FILTER_OPTIONS.find((o) => o.value === interest)?.color)} />
            )}
            {triggerLabel}
            {readState === "all" && interest === "all" && unreadTotal > 0 && (
              <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                {unreadTotal} unread
              </span>
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0 overflow-hidden">
        <div className="p-2 border-b border-border">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-xs"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          {!search.trim() && (
            <>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Inbox
              </p>
              {READ_STATE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => selectRead(o.value)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-secondary/60 flex items-center justify-between",
                    readState === o.value && interest === "all" ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground",
                  )}
                >
                  {o.label}
                  {o.value === "unread" && unreadTotal > 0 && (
                    <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                      {unreadTotal}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
          <p className="px-2 py-1 mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Instantly status
          </p>
          {!search.trim() && (
            <button
              type="button"
              onClick={() => selectInterest("all")}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-secondary/60",
                interest === "all" && readState === "all" ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground",
              )}
            >
              All statuses
            </button>
          )}
          {filteredInterest.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => selectInterest(o.value)}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-secondary/60 flex items-center gap-2",
                interest === o.value ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground",
              )}
            >
              <Zap className={cn("size-3.5 shrink-0", o.color)} />
              {o.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
