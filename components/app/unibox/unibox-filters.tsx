"use client";

import { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function CampaignMultiSelect({
  items,
  selectedIds,
  onChange,
}: {
  items: Array<{ id: string; name: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, search]);

  const allSelected = selectedIds.length === 0;
  const triggerText = allSelected
    ? "All campaigns"
    : selectedIds.length === 1
      ? items.find((i) => i.id === selectedIds[0])?.name ?? "1 selected"
      : `${selectedIds.length} campaigns`;

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs transition-colors max-w-[160px]",
            allSelected
              ? "border-border bg-card/60 text-muted-foreground hover:text-foreground hover:bg-secondary/40"
              : "border-primary/30 bg-primary/5 text-primary font-medium",
          )}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="p-2 border-b border-border">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns…"
            className="w-full h-7 px-2 rounded-md border border-border bg-background text-xs"
          />
        </div>
        <div className="p-1.5 border-b border-border flex gap-1">
          <button
            type="button"
            onClick={() => onChange(items.map((i) => i.id))}
            className="flex-1 text-[10px] py-1 rounded hover:bg-secondary/60 text-muted-foreground"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex-1 text-[10px] py-1 rounded hover:bg-secondary/60 text-muted-foreground"
          >
            Clear
          </button>
        </div>
        <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5">
          {filtered.map((item) => {
            const checked = selectedIds.includes(item.id);
            return (
              <label
                key={item.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer hover:bg-secondary/60",
                  checked && "bg-primary/5",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item.id)}
                  className="size-3.5 rounded border-border accent-primary"
                />
                <span className="truncate">{item.name}</span>
              </label>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No matches</p>
          )}
        </div>
        {!allSelected && (
          <div className="flex flex-wrap gap-1 p-1.5 border-t border-border">
            {selectedIds.map((id) => {
              const name = items.find((i) => i.id === id)?.name ?? id.slice(0, 8);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-0.5 max-w-full text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                >
                  <span className="truncate">{name}</span>
                  <button
                    type="button"
                    onClick={() => onChange(selectedIds.filter((x) => x !== id))}
                    className="shrink-0 hover:text-foreground"
                    aria-label={`Remove ${name}`}
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function InboxSelect({
  eaccount,
  eaccounts,
  onEaccount,
}: {
  eaccount: string | null;
  eaccounts: string[];
  onEaccount: (e: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eaccounts;
    return eaccounts.filter((e) => e.toLowerCase().includes(q));
  }, [eaccounts, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs transition-colors max-w-[160px]",
            !eaccount
              ? "border-border bg-card/60 text-muted-foreground hover:text-foreground hover:bg-secondary/40"
              : "border-primary/30 bg-primary/5 text-primary font-medium",
          )}
        >
          <span className="truncate">{eaccount ?? "All inboxes"}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="p-2 border-b border-border">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search inboxes…"
            className="w-full h-7 px-2 rounded-md border border-border bg-background text-xs"
          />
        </div>
        <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5">
          <button
            type="button"
            onClick={() => { onEaccount(null); setOpen(false); }}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-secondary/60",
              !eaccount ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground",
            )}
          >
            All inboxes
          </button>
          {filtered.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onEaccount(e); setOpen(false); }}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded-md text-xs truncate hover:bg-secondary/60",
                eaccount === e ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
