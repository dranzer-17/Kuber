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

type ReadStateProps = {
  readState: UniboxReadStateFilter;
  unreadTotal: number;
  onReadState: (v: UniboxReadStateFilter) => void;
};

export function UniboxInboxFilter({ readState, unreadTotal, onReadState }: ReadStateProps) {
  const [open, setOpen] = useState(false);

  function select(v: UniboxReadStateFilter) {
    onReadState(v);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex-1 flex items-center justify-between gap-2 h-9 px-3 rounded-lg border border-border bg-card text-sm font-medium hover:bg-secondary/40 transition-colors"
        >
          <span className="truncate flex items-center gap-2">
            {readStateLabel(readState)}
            {readState === "all" && unreadTotal > 0 && (
              <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                {unreadTotal} unread
              </span>
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        {READ_STATE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => select(o.value)}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-secondary/60 flex items-center justify-between",
              readState === o.value ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground",
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
      </PopoverContent>
    </Popover>
  );
}

type InterestProps = {
  interest: UniboxInterestFilter;
  onInterest: (v: UniboxInterestFilter) => void;
};

export function UniboxInterestFilterDropdown({ interest, onInterest }: InterestProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredInterest = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return INTEREST_FILTER_OPTIONS;
    return INTEREST_FILTER_OPTIONS.filter((o) => o.label.toLowerCase().includes(q));
  }, [search]);

  function select(v: UniboxInterestFilter) {
    onInterest(v);
    setOpen(false);
    setSearch("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex-1 flex items-center justify-between gap-2 h-9 px-3 rounded-lg border border-border bg-card text-sm font-medium hover:bg-secondary/40 transition-colors"
        >
          <span className="truncate flex items-center gap-2">
            {interest !== "all" && interest !== "lead" && (
              <Zap className={cn("size-3.5 shrink-0", INTEREST_FILTER_OPTIONS.find((o) => o.value === interest)?.color)} />
            )}
            {interestLabel(interest)}
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
            <button
              type="button"
              onClick={() => select("all")}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-secondary/60",
                interest === "all" ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground",
              )}
            >
              All statuses
            </button>
          )}
          {filteredInterest.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => select(o.value)}
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
