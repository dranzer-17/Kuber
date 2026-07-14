"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { AlertCircle, Check, CheckCircle2, FileText, Plus, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { badgeVariants } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { AppCheckbox } from "@/components/ui/app-checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LOCATION_MAP, LOCATION_CATEGORIES, APOLLO_TITLES, APOLLO_SENIORITIES, INDUSTRY_KEYWORD_CATEGORIES, BATCH_COLORS, getBatchColor } from "@/lib/constants";
import { InfoTip } from "@/components/ui/info-tip";
import { importExcelDirect, createLead, patchLead, patchOrg, fetchUsers, type Profile, type PreviewLead, type DuplicateOwner } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { BatchConfirmModal } from "@/components/app/batch-confirm-modal";
import { TagInput } from "@/components/app/tag-input";

export { TagInput };

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

// ─── BatchNameField ───────────────────────────────────────────────────────────

function BatchNameField({
  value,
  onChange,
  color,
  onColorChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  color: string;
  onColorChange: (c: string) => void;
  error?: boolean;
}) {
  const [swatchOpen, setSwatchOpen] = useState(false);
  const swatchRef = useRef<HTMLDivElement>(null);
  const c = getBatchColor(color);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (swatchRef.current && !swatchRef.current.contains(e.target as Node)) setSwatchOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Batch</p>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium text-muted-foreground">Batch Name</span>
              <span className="text-destructive text-xs">*</span>
              <InfoTip
                side="right"
                text="Name this import so you can recognise it later (e.g. 'India Plastics Q3'). The name becomes a coloured tag on every lead in this batch."
              />
              {value.trim() && (
                <span className={cn("ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium", c.pill)}>
                  <span className={cn("size-1.5 rounded-full shrink-0", c.bg)} />
                  {value}
                </span>
              )}
            </div>
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="e.g. India Plastics Q3…"
              className={cn("h-8 text-sm", error && "border-destructive focus-visible:ring-destructive")}
            />
            {error && (
              <p className="text-[10px] text-destructive flex items-center gap-1">
                <AlertCircle className="size-3 shrink-0" /> Batch name is required
              </p>
            )}
          </div>
          <div ref={swatchRef} className="relative shrink-0 space-y-1">
            <span className="text-xs font-medium text-muted-foreground block">Colour</span>
            <button
              type="button"
              onClick={() => setSwatchOpen((o) => !o)}
              className={cn(
                "flex items-center gap-2 h-8 px-3 rounded-md border border-input bg-transparent text-sm transition-colors hover:bg-secondary",
                swatchOpen && "ring-2 ring-ring border-transparent",
              )}
            >
              <span className={cn("size-3.5 rounded-full shrink-0", c.bg)} />
              <span className="capitalize text-xs">{color}</span>
            </button>
            {swatchOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-10 rounded-xl border border-border bg-popover shadow-xl p-3.5 grid grid-cols-4 gap-3.5 w-[188px]">
                {BATCH_COLORS.map((bc) => (
                  <button
                    key={bc.name}
                    type="button"
                    title={bc.name}
                    onClick={() => { onColorChange(bc.name); setSwatchOpen(false); }}
                    className={cn(
                      "size-8 rounded-full transition-all",
                      bc.bg,
                      color === bc.name
                        ? "ring-2 ring-white ring-offset-2 ring-offset-popover scale-110"
                        : "hover:scale-110 opacity-80 hover:opacity-100",
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AssignToField ────────────────────────────────────────────────────────────
// Shared by all three add-lead tabs (Apollo, Excel, Manual): lets the Manager
// route the whole imported batch to one employee at creation time, instead of
// leaving every lead in the pool for manual assignment later.

function useAssignableEmployees(enabled: boolean) {
  const [employees, setEmployees] = useState<Profile[]>([]);

  useEffect(() => {
    if (!enabled) return;
    getToken().then((token) => fetchUsers(token)).then((users) => {
      setEmployees(users.filter((u) => u.role === "employee" && u.is_active));
    }).catch(() => {});
  }, [enabled]);

  return employees;
}

function AssignToField({
  employees,
  value,
  onChange,
}: {
  employees: Profile[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (employees.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <Label>Assign to</Label>
      <Select value={value || "unassigned"} onValueChange={(v) => onChange(v === "unassigned" ? "" : v)}>
        <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">Leave in pool (unassigned)</SelectItem>
          {employees.map((e) => (
            <SelectItem key={e.id} value={e.id}>{e.full_name || e.email}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── AssignStrategyPicker ─────────────────────────────────────────────────────
// Batch imports (Apollo, Excel) can distribute leads as they land: to one
// employee, spread round-robin (least-loaded first), or by territory
// (India / rest of world).

export type ImportAssignMode = "pool" | "manual" | "round_robin" | "territory";

const ASSIGN_MODE_OPTIONS: { value: ImportAssignMode; label: string; hint: string }[] = [
  { value: "pool",        label: "Leave in pool",      hint: "Unassigned — distribute later from the Leads page." },
  { value: "manual",      label: "One employee",       hint: "The whole batch goes to one person." },
  { value: "round_robin", label: "Round-robin",        hint: "Spread across all active employees, least-loaded first." },
  { value: "territory",   label: "By territory",       hint: "India → India reps, everything else → Foreign reps. Leads without a country stay in the pool." },
];

/** Request fields for the chosen mode — matches the import APIs. */
export function buildImportAssignment(mode: ImportAssignMode, assignTo: string):
  { assigned_to?: string; assignment_strategy?: "round_robin" | "territory" } {
  if (mode === "manual" && assignTo) return { assigned_to: assignTo };
  if (mode === "round_robin" || mode === "territory") return { assignment_strategy: mode };
  return {};
}

function AssignStrategyPicker({
  employees,
  mode,
  onModeChange,
  assignTo,
  onAssignToChange,
}: {
  employees: Profile[];
  mode: ImportAssignMode;
  onModeChange: (m: ImportAssignMode) => void;
  assignTo: string;
  onAssignToChange: (v: string) => void;
}) {
  if (employees.length === 0) return null;
  const active = ASSIGN_MODE_OPTIONS.find((o) => o.value === mode);
  return (
    <div className="space-y-1.5">
      <Label>Assign imported leads</Label>
      <div className="flex flex-wrap gap-1.5">
        {ASSIGN_MODE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.hint}
            onClick={() => onModeChange(opt.value)}
            className={cn(
              "px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              mode === opt.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-muted-foreground border-border hover:border-muted-foreground/40 hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {mode === "manual" && (
        <Select value={assignTo || "unassigned"} onValueChange={(v) => onAssignToChange(v === "unassigned" ? "" : v)}>
          <SelectTrigger className="bg-card"><SelectValue placeholder="Pick an employee" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Pick an employee…</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.full_name || e.email}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {active && <p className="text-xs text-muted-foreground">{active.hint}</p>}
    </div>
  );
}

// Surfaces WHO already owns a skipped duplicate — previously the importer was
// just told "N skipped" with no idea the lead already belongs to someone else
// (review §3.3). Shown as a toast right after import completes.
function notifyDuplicateOwners(duplicates: DuplicateOwner[] | undefined, employees: Profile[]) {
  if (!duplicates || duplicates.length === 0) return;
  const ownerName = (id: string | null) => {
    if (!id) return "the pool (unassigned)";
    return employees.find((e) => e.id === id)?.full_name
      || employees.find((e) => e.id === id)?.email
      || "another user";
  };
  const sample = duplicates.slice(0, 3).map((d) => {
    const who = d.email ?? d.name ?? "a lead";
    return `${who} (owned by ${ownerName(d.assigned_to)})`;
  }).join(", ");
  const more = duplicates.length > 3 ? ` and ${duplicates.length - 3} more` : "";
  toast.warning(`${duplicates.length} lead${duplicates.length === 1 ? "" : "s"} already exist${duplicates.length === 1 ? "s" : ""} — skipped: ${sample}${more}.`, { duration: 8000 });
}

// ─── IndustryKeywordsDropdown ─────────────────────────────────────────────────

const ALL_INDUSTRY_KEYWORDS = INDUSTRY_KEYWORD_CATEGORIES.flatMap((c) => c.keywords.map((k) => k.label));

function IndustryKeywordsDropdown({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const customKeywords = selected.filter((kw) => !ALL_INDUSTRY_KEYWORDS.includes(kw));

  const displayCategories: Array<{ id: string; label: string; keywords: { label: string }[] }> = [
    ...INDUSTRY_KEYWORD_CATEGORIES,
    ...(customKeywords.length > 0
      ? [{ id: "custom", label: "Custom Keywords", keywords: customKeywords.map((label) => ({ label })) }]
      : []),
  ];

  function toggleKw(label: string) {
    onChange(selected.includes(label) ? selected.filter((s) => s !== label) : [...selected, label]);
  }

  function toggleCategoryKws(kws: string[]) {
    const allSelected = kws.every((k) => selected.includes(k));
    if (allSelected) {
      onChange(selected.filter((s) => !kws.includes(s)));
    } else {
      onChange([...selected, ...kws.filter((k) => !selected.includes(k))]);
    }
  }

  function addCustomKeyword() {
    const kw = customInput.trim();
    if (!kw || selected.includes(kw)) return;
    onChange([...selected, kw]);
    setCustomInput("");
    customInputRef.current?.focus();
  }

  const selectedCount = selected.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Label>
            Industry Segments <span className="text-destructive ml-0.5">*</span>
          </Label>
          <InfoTip side="right" text="Keywords filter Apollo's database by industry. Use 'plastics', 'polymer', 'moulding' or 'packaging' to target the right segment. At least one is required." />
        </div>
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all ({selectedCount})
          </button>
        )}
      </div>

      <div ref={ref} className="relative">
        {/* Trigger */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "w-full flex items-center justify-between px-3 py-2 rounded-md border text-sm transition-colors text-left",
            open ? "border-ring ring-1 ring-ring" : "border-input hover:border-muted-foreground",
            "bg-card",
          )}
        >
          <span className={selectedCount === 0 ? "text-muted-foreground/60" : "text-foreground"}>
            {selectedCount === 0
              ? "Select industry segments…"
              : `${selectedCount} segment${selectedCount !== 1 ? "s" : ""} selected`}
          </span>
          <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {/* Panel */}
        {open && (
          <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/40">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {selectedCount > 0 ? `${selectedCount} of ${ALL_INDUSTRY_KEYWORDS.length} selected` : "Select industry segments"}
              </p>
              <button
                type="button"
                onClick={() => onChange([...ALL_INDUSTRY_KEYWORDS])}
                className="text-[11px] text-primary hover:underline font-medium"
              >
                Select all
              </button>
            </div>

            {/* 3-column grid of categories */}
            <div className="grid grid-cols-3 max-h-72 overflow-y-auto">
              {(() => {
                type CatItem = { id: string; label: string; keywords: { label: string }[] };
                const cols: CatItem[][] = [[], [], []];
                displayCategories.forEach((cat, i) => cols[i % 3].push(cat));
                return cols.map((col, ci) => (
                  <div key={ci} className={cn("flex flex-col", ci < 2 && "border-r border-border")}>
                    {col.map((cat, catIdx) => {
                      const catKws = cat.keywords.map((k) => k.label);
                      const allCatSelected = catKws.every((k) => selected.includes(k));
                      const someCatSelected = catKws.some((k) => selected.includes(k));
                      const isCustom = cat.id === "custom";
                      return (
                        <div key={cat.id} className={cn("px-3 pt-3 pb-2", catIdx > 0 && "border-t border-border/60", isCustom && "bg-amber-500/5")}>
                          {/* Category header — centered, bold */}
                          <button
                            type="button"
                            onClick={() => toggleCategoryKws(catKws)}
                            className="w-full flex flex-col items-center gap-1.5 mb-2 group"
                          >
                            <div className="flex items-center gap-2">
                              <AppCheckbox
                                size="sm"
                                checked={allCatSelected ? true : someCatSelected ? "indeterminate" : false}
                              />
                              <span className={cn(
                                "text-[11px] font-bold uppercase tracking-wide transition-colors text-center leading-tight",
                                isCustom ? "text-amber-400 group-hover:text-amber-300" : "text-foreground group-hover:text-primary",
                              )}>
                                {cat.label}
                              </span>
                            </div>
                            <div className="w-full h-px bg-border/60" />
                          </button>
                          {/* Keywords */}
                          <div className="space-y-0.5">
                            {cat.keywords.map((kw) => {
                              const checked = selected.includes(kw.label);
                              return (
                                <div
                                  key={kw.label}
                                  className={cn(
                                    "w-full flex items-center gap-2 px-2 py-1 rounded transition-colors",
                                    checked ? "bg-primary/10" : "hover:bg-secondary/60",
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleKw(kw.label)}
                                    className="flex items-center gap-2 flex-1 text-left min-w-0"
                                  >
                                    <AppCheckbox size="sm" checked={checked} />
                                    <span className={cn("text-xs leading-tight truncate", checked ? "text-foreground font-medium" : "text-muted-foreground")}>
                                      {kw.label}
                                    </span>
                                  </button>
                                  {isCustom && (
                                    <button
                                      type="button"
                                      onClick={() => onChange(selected.filter((s) => s !== kw.label))}
                                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                                      title="Remove custom keyword"
                                    >
                                      <X className="size-3" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>

            {/* Manual keyword input */}
            <div className="border-t border-border px-4 py-3 bg-secondary/20">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Add custom keyword</p>
              <div className="flex items-center gap-2">
                <input
                  ref={customInputRef}
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addCustomKeyword(); }
                    if (e.key === "Escape") setOpen(false);
                  }}
                  placeholder="e.g. masterbatch manufacturer…"
                  className="flex-1 bg-transparent text-xs border border-input rounded-md px-3 py-1.5 outline-none focus:border-ring focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={addCustomKeyword}
                  disabled={!customInput.trim() || selected.includes(customInput.trim())}
                  className="h-auto shrink-0 gap-1 px-3 py-1.5 text-xs [&_svg]:size-3"
                >
                  <Plus /> Add
                </Button>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-border px-4 py-2 flex items-center justify-end bg-secondary/30">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Selected pills */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {selected.map((kw) => (
            <span key={kw} className={cn(badgeVariants({ variant: "selected" }), "gap-1 px-2")}>
              {kw}
              <button type="button" onClick={() => toggleKw(kw)} className="hover:text-destructive transition-colors">
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LocationsDropdown ────────────────────────────────────────────────────────

const ALL_LOCATION_KEYS = Object.keys(LOCATION_MAP);

function LocationsDropdown({
  selected,
  onChangeSelected,
}: {
  selected: string[];
  onChangeSelected: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggleCountry(country: string) {
    onChangeSelected(selected.includes(country) ? selected.filter((c) => c !== country) : [...selected, country]);
  }

  function toggleRegion(countries: string[]) {
    const allSel = countries.every((c) => selected.includes(c));
    if (allSel) onChangeSelected(selected.filter((c) => !countries.includes(c)));
    else onChangeSelected([...selected, ...countries.filter((c) => !selected.includes(c))]);
  }

  const selectedCount = selected.length;
  const totalCount = ALL_LOCATION_KEYS.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Label>Locations</Label>
          <InfoTip side="right" text="No selection = worldwide search. Select specific countries to narrow results, or leave empty to search globally." />
        </div>
        {selectedCount > 0 && (
          <button type="button" onClick={() => onChangeSelected([])} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            Clear ({selectedCount})
          </button>
        )}
      </div>

      <div ref={ref} className="relative">
        {/* Trigger */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "w-full flex items-center justify-between px-3 py-2 rounded-md border text-sm transition-colors text-left bg-card",
            open ? "border-ring ring-1 ring-ring" : "border-input hover:border-muted-foreground",
          )}
        >
          <span className={selectedCount === 0 ? "text-muted-foreground/60" : "text-foreground"}>
            {selectedCount === 0
              ? "Select countries… (empty = worldwide)"
              : `${selectedCount} countr${selectedCount !== 1 ? "ies" : "y"} selected`}
          </span>
          <svg viewBox="0 0 24 24" className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {/* Panel */}
        {open && (
          <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/40">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {selectedCount > 0 ? `${selectedCount} of ${totalCount} selected` : "Select countries by region"}
              </p>
              <button type="button" onClick={() => onChangeSelected([...ALL_LOCATION_KEYS])} className="text-[11px] text-primary hover:underline font-medium">
                Select all
              </button>
            </div>

            {/* 5-column grid of regions */}
            <div className="grid grid-cols-5 max-h-80 overflow-y-auto">
              {(() => {
                const cols: (typeof LOCATION_CATEGORIES)[] = [[], [], [], [], []];
                LOCATION_CATEGORIES.forEach((cat, i) => cols[i % 5].push(cat));
                return cols.map((col, ci) => (
                  <div key={ci} className={cn("flex flex-col", ci < 4 && "border-r border-border")}>
                    {col.map((region, ri) => {
                      const allSel = region.countries.every((c) => selected.includes(c));
                      const someSel = region.countries.some((c) => selected.includes(c));
                      return (
                        <div key={region.id} className={cn("px-3 pt-3 pb-2", ri > 0 && "border-t border-border/60")}>
                          {/* Region header */}
                          <button
                            type="button"
                            onClick={() => toggleRegion(region.countries)}
                            className="w-full flex flex-col items-center gap-1.5 mb-2 group"
                          >
                            <div className="flex items-center gap-2">
                              <AppCheckbox
                                size="sm"
                                checked={allSel ? true : someSel ? "indeterminate" : false}
                              />
                              <span className="text-[11px] font-bold uppercase tracking-wide text-foreground group-hover:text-primary transition-colors text-center leading-tight">
                                {region.label}
                              </span>
                            </div>
                            <div className="w-full h-px bg-border/60" />
                          </button>
                          {/* Countries */}
                          <div className="space-y-0.5">
                            {region.countries.map((country) => {
                              const checked = selected.includes(country);
                              return (
                                <button
                                  key={country}
                                  type="button"
                                  onClick={() => toggleCountry(country)}
                                  className={cn(
                                    "w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors",
                                    checked ? "bg-primary/10" : "hover:bg-secondary/60",
                                  )}
                                >
                                  <AppCheckbox size="sm" checked={checked} />
                                  <span className={cn("text-xs leading-tight", checked ? "text-foreground font-medium" : "text-muted-foreground")}>
                                    {country}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-4 py-2.5 flex items-center justify-end bg-secondary/20">
              <button type="button" onClick={() => setOpen(false)} className="text-xs font-medium text-primary hover:underline">
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Selected pills */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {selected.map((c) => (
            <span key={c} className={cn(badgeVariants({ variant: "selected" }), "gap-1 px-2")}>
              {c}
              <button type="button" onClick={() => toggleCountry(c)} className="hover:text-destructive transition-colors">
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Apollo ───────────────────────────────────────────────────────────────────

export function ApolloForm({ onImport }: { onImport: (n: number) => void }) {
  const [keywords,      setKeywords     ] = useState<string[]>([]);
  const [positions,     setPositions    ] = useState<string[]>([]);
  const [seniorities,   setSeniorities  ] = useState<string[]>([]);
  const [locations,     setLocations    ] = useState<string[]>([]);
  const [maxPages,      setMaxPages     ] = useState(1);
  const [batchName,     setBatchName    ] = useState("");
  const [color,         setColor        ] = useState("violet");
  const [batchNameError, setBatchNameError] = useState(false);
  const [importing,     setImporting    ] = useState(false);
  const [error,         setError        ] = useState("");
  const [assignTo,      setAssignTo     ] = useState("");
  const [assignMode,    setAssignMode   ] = useState<ImportAssignMode>("pool");
  const employees = useAssignableEmployees(true);

  function toggleSen(s: string) {
    setSeniorities((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  }

  const effectiveLocations = locations.map((l) => LOCATION_MAP[l] ?? l);

  async function handleImport(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (keywords.length === 0) { setError("Please select an industry keyword."); return; }
    if (!batchName.trim()) { setBatchNameError(true); return; }
    setBatchNameError(false);
    setError("");
    setImporting(true);
    try {
      const token = await getToken();
      // Search + lead insert happen synchronously server-side; only email
      // enrichment (Phase 2) runs in the background after this responds.
      const response = await fetch("/api/v1/leads/apollo-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          keywords,
          locations: effectiveLocations,
          max_pages: maxPages,
          titles: positions.length > 0 ? positions : [...APOLLO_TITLES],
          seniorities: seniorities.length > 0 ? seniorities : undefined,
          batch_name: batchName,
          color,
          ...buildImportAssignment(assignMode, assignTo),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.message ?? `Request failed: ${response.status}`);
      const inserted = json?.data?.inserted ?? 0;
      const warnings: string[] = json?.data?.warnings ?? [];
      if (inserted === 0) {
        // Nothing was saved — don't redirect into an empty batch, tell the user why.
        setError(
          warnings.length > 0
            ? `No leads were imported: ${warnings[0]}`
            : "No leads matched this search. Try different keywords, titles, or locations."
        );
        setImporting(false);
        return;
      }
      // Phase 1 complete — leads are in the DB, redirect now.
      // Email enrichment runs in the background on the server.
      notifyDuplicateOwners(json?.data?.duplicate_owners, employees);
      onImport(inserted);
    } catch (e) {
      setError((e as Error).message);
      setImporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Search Apollo&apos;s database to find plastic &amp; polymer industry leads.
      </p>
      <form onSubmit={handleImport} className="space-y-4">
        <IndustryKeywordsDropdown selected={keywords} onChange={setKeywords} />
        <div className="space-y-1.5">
          <Label>Pages to fetch (50 leads/page)</Label>
          <Select value={String(maxPages)} onValueChange={(v) => setMaxPages(Number(v))}>
            <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1,2,3,5,10].map((n) => (
                <SelectItem key={n} value={String(n)}>{n} page{n > 1 ? "s" : ""} (~{n * 50} leads)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TagInput
          label="Positions / Job Titles"
          pills={positions}
          suggestions={APOLLO_TITLES}
          onChange={setPositions}
          placeholder="e.g. VP, Plant Manager…"
          tip="Leave empty to use 40+ built-in titles. Add specific titles to narrow results to those roles only."
        />

        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label>Seniority</Label>
            <InfoTip side="right" text="Filters out junior contacts. Target decision-makers like VP, Director, or C-Suite. Leave unselected to include all levels." />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {APOLLO_SENIORITIES.map((s) => (
              <button
                key={s} type="button" onClick={() => toggleSen(s)}
                className={cn(
                  badgeVariants({ variant: seniorities.includes(s) ? "selected" : "unselected" }),
                  "py-1",
                )}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <LocationsDropdown
          selected={locations}
          onChangeSelected={setLocations}
        />

        <BatchNameField
          value={batchName}
          onChange={(v) => { setBatchName(v); if (v.trim()) setBatchNameError(false); }}
          color={color}
          onColorChange={setColor}
          error={batchNameError}
        />

        <AssignStrategyPicker
          employees={employees}
          mode={assignMode}
          onModeChange={setAssignMode}
          assignTo={assignTo}
          onAssignToChange={setAssignTo}
        />

        <Button type="submit" disabled={importing || keywords.length === 0} className="gap-1.5" title={keywords.length === 0 ? "Add at least one keyword" : undefined}>
          <Search className="size-3.5" />
          {importing ? "Searching & saving leads…" : "Import leads"}
        </Button>
      </form>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5">
          <AlertCircle className="size-3.5 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

// ─── Excel / CSV ──────────────────────────────────────────────────────────────

const PLATFORM_FIELDS = [
  { key: "email",               label: "Email",           required: true,  note: "Blocks progress if unmapped" },
  { key: "first_name",          label: "First Name",      required: true,  note: "" },
  { key: "last_name",           label: "Last Name",       required: false, note: "" },
  { key: "organization_name",   label: "Company Name",    required: false, note: "" },
  { key: "organization_domain", label: "Company Domain",  required: true,  note: "Required for Firecrawl enrichment" },
  { key: "title",               label: "Job Title",       required: false, note: "" },
];

type ParseResult = {
  inserted: number;
  skipped_blank_email: number;
  skipped_invalid_email: number;
  skipped_duplicate_in_file: number;
  skipped_duplicate_in_db: number;
};

export function ExcelForm({ onImport }: { onImport: (n: number) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  type Stage = "upload" | "map" | "result";
  const [stage,       setStage      ] = useState<Stage>("upload");
  const [fileName,    setFileName   ] = useState("");
  const [headers,     setHeaders    ] = useState<string[]>([]);
  const [rows,        setRows       ] = useState<Record<string, string>[]>([]);
  const [mapping,     setMapping    ] = useState<Record<string, string>>({});
  const [batchName,   setBatchName  ] = useState("");
  const [color,       setColor      ] = useState("violet");
  const [batchNameError, setBatchNameError] = useState(false);
  const [importing,   setImporting  ] = useState(false);
  const [showConfirm,     setShowConfirm    ] = useState(false);
  const [showRawPreview,  setShowRawPreview ] = useState(false);
  const [result,          setResult         ] = useState<ParseResult | null>(null);
  const [fileError,       setFileError      ] = useState("");
  const [assignTo,        setAssignTo       ] = useState("");
  const [assignMode,      setAssignMode     ] = useState<ImportAssignMode>("pool");
  const employees = useAssignableEmployees(true);

  function tryAutoMap(cols: string[]): Record<string, string> {
    const auto: Record<string, string> = {};
    const n = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    for (const pf of PLATFORM_FIELDS) {
      const match = cols.find((c) => {
        const nc = n(c);
        if (pf.key === "email"               && (nc.includes("email") || nc.includes("mail"))) return true;
        if (pf.key === "first_name"          && (nc.includes("firstname") || nc.includes("contactperson") || nc.includes("contact") || nc === "name")) return true;
        if (pf.key === "last_name"           && nc.includes("lastname")) return true;
        if (pf.key === "organization_name"   && (nc.includes("company") || nc.includes("org"))) return true;
        if (pf.key === "organization_domain" && (nc.includes("website") || nc.includes("domain") || nc.includes("url") || nc.includes("web"))) return true;
        if (pf.key === "title"               && (nc.includes("title") || nc.includes("designation") || nc.includes("position") || nc.includes("role"))) return true;
        return false;
      });
      if (match) auto[pf.key] = match;
    }
    return auto;
  }

  function handleFile(file: File) {
    setFileError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        // Parse as raw arrays first to find the actual header row (first non-empty row)
        const raw  = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
        const headerRowIdx = raw.findIndex((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
        if (headerRowIdx === -1) { setFileError("The file appears to be empty."); return; }
        // Re-parse starting from the detected header row
        const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
        range.s.r = headerRowIdx;
        ws["!ref"] = XLSX.utils.encode_range(range);
        const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
        if (json.length === 0) { setFileError("The file appears to be empty."); return; }
        const cols = Object.keys(json[0]);
        setHeaders(cols); setRows(json); setMapping(tryAutoMap(cols)); setFileName(file.name); setStage("map");
      } catch {
        setFileError("Could not read file. Make sure it is a valid .xlsx or .csv.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleConfirm() {
    setImporting(true);
    try {
      const token = await getToken();
      const res = await importExcelDirect(token, rows, mapping, batchName, color, buildImportAssignment(assignMode, assignTo));
      setShowConfirm(false);
      setResult(res);
      setStage("result");
      notifyDuplicateOwners(res.duplicate_owners, employees);
      onImport(res.inserted);
    } catch (e) {
      setShowConfirm(false);
      setFileError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setStage("upload"); setFileName(""); setHeaders([]); setRows([]); setMapping({});
    setBatchName(""); setColor("violet"); setBatchNameError(false);
    setResult(null); setFileError(""); setAssignTo(""); setAssignMode("pool");
  }

  const previewLeads: PreviewLead[] = rows.map((row) => ({
    firstName: mapping.first_name           ? String(row[mapping.first_name]           ?? "") : "",
    lastName:  mapping.last_name            ? String(row[mapping.last_name]            ?? "") : "",
    email:     mapping.email                ? String(row[mapping.email]                ?? "") : "",
    company:   mapping.organization_name    ? String(row[mapping.organization_name]    ?? "") : "",
    domain:    mapping.organization_domain  ? String(row[mapping.organization_domain]  ?? "") : "",
    jobTitle:  mapping.title                ? String(row[mapping.title]                ?? "") : "",
  }));

  if (stage === "upload") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Every spreadsheet has different headers — we detect your columns and let you map them to platform fields.
        </p>
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          className="border-2 border-dashed border-border hover:border-muted-foreground rounded-xl p-12 flex flex-col items-center gap-3 cursor-pointer transition-colors"
        >
          <Upload className="size-8 text-muted-foreground/50" />
          <p className="font-medium text-sm">Click or drag to upload</p>
          <p className="text-xs text-muted-foreground">.xlsx or .csv · any column layout supported</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
        {fileError && (
          <div className="flex items-center gap-2 text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5">
            <AlertCircle className="size-3.5 shrink-0" /> {fileError}
          </div>
        )}
      </div>
    );
  }

  if (stage === "map") {
    const emailMapped     = !!mapping.email;
    const firstNameMapped = !!mapping.first_name;
    const domainMapped    = !!mapping.organization_domain;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 px-4 py-3">
          <FileText className="size-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{fileName}</p>
            <p className="text-xs text-muted-foreground">{rows.length} rows · {headers.length} columns detected</p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setShowRawPreview(true)}>View</Button>
          <Button variant="outline" size="sm" className="shrink-0" onClick={reset}>Change</Button>
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          <div className="grid grid-cols-2 px-4 py-2.5 bg-secondary/40 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground">Platform field</span>
            <span className="text-xs font-semibold text-muted-foreground">Your column</span>
          </div>
          {PLATFORM_FIELDS.map((pf) => {
            const mapped = mapping[pf.key];
            return (
              <div key={pf.key} className="grid grid-cols-2 px-4 py-3 border-b border-border last:border-0 items-center gap-3">
                <div>
                  <span className="text-sm">{pf.label}{pf.required && <span className="text-destructive ml-1 text-xs">*</span>}</span>
                  {pf.note && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{pf.note}</p>}
                </div>
                <Select value={mapped || "__none"} onValueChange={(v) => setMapping((m) => { const next = { ...m }; if (v === "__none") delete next[pf.key]; else next[pf.key] = v; return next; })}>
                  <SelectTrigger className={cn("h-8 text-xs", mapped ? "border-primary/40 bg-primary/5" : "bg-card")}>
                    <SelectValue placeholder="Not mapped" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none"><span className="text-muted-foreground">Not mapped</span></SelectItem>
                    {headers.map((h) => <SelectItem key={h} value={h}>{h.length > 40 ? `${h.slice(0, 38)}…` : h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>

        <div className="space-y-1.5">
          {!emailMapped && <div className="flex items-center gap-2 text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2"><AlertCircle className="size-3.5 shrink-0" />Email column must be mapped before importing</div>}
          {emailMapped && !firstNameMapped && <div className="flex items-center gap-2 text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2"><AlertCircle className="size-3.5 shrink-0" />First Name must be mapped before importing</div>}
          {emailMapped && firstNameMapped && !domainMapped && <div className="flex items-center gap-2 text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2"><AlertCircle className="size-3.5 shrink-0" />Company Domain must be mapped before importing</div>}
          {fileError && <div className="flex items-center gap-2 text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2"><AlertCircle className="size-3.5 shrink-0" />{fileError}</div>}
        </div>

        <BatchNameField
          value={batchName}
          onChange={(v) => { setBatchName(v); if (v.trim()) setBatchNameError(false); }}
          color={color}
          onColorChange={setColor}
          error={batchNameError}
        />

        <AssignStrategyPicker
          employees={employees}
          mode={assignMode}
          onModeChange={setAssignMode}
          assignTo={assignTo}
          onAssignToChange={setAssignTo}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{rows.length} rows will be processed</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset}>Back</Button>
            <Button
              disabled={!emailMapped || !firstNameMapped || !domainMapped || importing}
              onClick={() => {
                if (!batchName.trim()) { setBatchNameError(true); return; }
                setBatchNameError(false);
                setShowConfirm(true);
              }}
            >
              Preview & Import
            </Button>
          </div>
        </div>

        {showConfirm && (
          <BatchConfirmModal
            source="excel"
            leads={previewLeads}
            totalCount={rows.length}
            confirming={importing}
            onConfirm={() => { void handleConfirm(); }}
            onCancel={() => setShowConfirm(false)}
          />
        )}

        <Dialog open={showRawPreview} onOpenChange={setShowRawPreview}>
          <DialogContent className="max-w-5xl w-full p-0 gap-0 flex flex-col max-h-[85vh]">
            <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
              <DialogTitle className="text-sm font-semibold">{fileName}</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{rows.length} rows · {headers.length} columns</p>
            </DialogHeader>
            <div className="flex-1 overflow-auto min-h-0">
              <table className="text-xs border-collapse min-w-max w-full">
                <thead className="sticky top-0 bg-secondary/80 backdrop-blur-sm z-10">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground border-b border-border w-10">#</th>
                    {headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground border-b border-border whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground/60 tabular-nums">{i + 1}</td>
                      {headers.map((h) => (
                        <td key={h} className="px-3 py-2 text-foreground/80 max-w-[200px] truncate whitespace-nowrap" title={String(row[h] ?? "")}>
                          {String(row[h] ?? "") || <span className="text-muted-foreground/40">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // result stage
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 px-5 py-4 flex items-center gap-3">
        <CheckCircle2 className="size-5 text-green-400 shrink-0" />
        <div>
          <p className="font-semibold text-green-400">{result?.inserted} leads imported</p>
          <p className="text-xs text-muted-foreground mt-0.5">from {fileName}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Duplicates removed",   value: (result?.skipped_duplicate_in_file ?? 0) + (result?.skipped_duplicate_in_db ?? 0), tone: "amber" as const },
          { label: "Blank emails skipped", value: result?.skipped_blank_email,   tone: "zinc" as const },
          { label: "Invalid format",       value: result?.skipped_invalid_email, tone: "red" as const },
        ].map(({ label, value, tone }) => (
          <StatTile key={label} label={label} value={value ?? 0} tone={tone} />
        ))}
      </div>
      <Button variant="outline" onClick={reset}>Upload another file</Button>
    </div>
  );
}

// ─── Manual ───────────────────────────────────────────────────────────────────

type OrgFields  = { name: string; industry: string; domain: string; country: string };
type LeadEntry  = { firstName: string; lastName: string; email: string; jobTitle: string; id?: string };
const BLANK_LEAD = (): LeadEntry => ({ firstName: "", lastName: "", email: "", jobTitle: "" });

export interface ManualFormProps {
  onImport: (n: number) => void;
  prefillOrg?: { name: string; industry: string; domain: string; country: string; id?: string };
  prefillLeads?: Array<{ firstName: string; lastName: string; email: string; jobTitle: string; id?: string }>;
  editMode?: boolean;
}

export function ManualForm({ onImport, prefillOrg, prefillLeads, editMode = false }: ManualFormProps) {
  const [org, setOrg] = useState<OrgFields>({
    name:     prefillOrg?.name     ?? "",
    industry: prefillOrg?.industry ?? "",
    domain:   prefillOrg?.domain   ?? "",
    country:  prefillOrg?.country  ?? "",
  });
  const [leads,       setLeads      ] = useState<LeadEntry[]>(prefillLeads?.length ? prefillLeads.map((l) => ({ ...l })) : [BLANK_LEAD()]);
  const [batchName,   setBatchName  ] = useState("");
  const [color,       setColor      ] = useState("violet");
  const [batchNameError, setBatchNameError] = useState(false);
  const [saving,      setSaving     ] = useState(false);
  const [saved,       setSaved      ] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error,       setError      ] = useState("");
  const [assignTo,    setAssignTo   ] = useState<string>("");
  const employees = useAssignableEmployees(!editMode);

  function addLead()                                        { setLeads((p) => [...p, BLANK_LEAD()]); }
  function removeLead(i: number)                            { if (leads.length > 1) setLeads((p) => p.filter((_, j) => j !== i)); }
  function updateLead(i: number, f: keyof LeadEntry, v: string) { setLeads((p) => p.map((l, j) => j === i ? { ...l, [f]: v } : l)); }

  function handleOpenConfirm() {
    if (!org.name.trim())   { setError("Organization name is required."); return; }
    if (!org.domain.trim()) { setError("Company website / domain is required."); return; }
    for (const l of leads) {
      if (!l.firstName.trim()) { setError("Each lead needs a first name."); return; }
      if (!l.email.trim())     { setError("Each lead needs an email."); return; }
    }
    setError("");
    if (editMode) {
      void handleSaveAll();
    } else {
      if (!batchName.trim()) { setBatchNameError(true); return; }
      setBatchNameError(false);
      setShowConfirm(true);
    }
  }

  async function handleSaveAll(overrideBatchName?: string, overrideColor?: string) {
    const resolvedBatchName = overrideBatchName ?? batchName;
    const resolvedColor = overrideColor ?? color;
    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      let savedCount = 0;
      let sharedImportId: string | undefined;

      if (editMode && prefillOrg?.id) {
        await patchOrg(token, prefillOrg.id, { name: org.name, domain: org.domain, industry: org.industry || undefined, country: org.country || undefined });
      }

      for (const entry of leads) {
        if (editMode && entry.id) {
          await patchLead(token, entry.id, {
            first_name: entry.firstName, last_name: entry.lastName || undefined,
            email: entry.email, title: entry.jobTitle || undefined, country: org.country || undefined,
          });
        } else {
          const created = await createLead(token, {
            email:                entry.email,
            first_name:           entry.firstName,
            last_name:            entry.lastName || undefined,
            organization_name:    org.name,
            organization_domain:  org.domain,
            organization_industry: org.industry || undefined,
            organization_country: org.country || undefined,
            title:                entry.jobTitle || undefined,
            country:              org.country || undefined,
            assigned_to:          assignTo || undefined,
            // all leads in this batch share one import row
            ...(sharedImportId ? { import_id: sharedImportId } : { batch_name: resolvedBatchName, color: resolvedColor }),
          });
          if (!sharedImportId && created.import_id) sharedImportId = created.import_id;
        }
        savedCount++;
      }

      setShowConfirm(false);
      onImport(savedCount);
      setSaved(true);
      if (!editMode) {
        setOrg({ name: "", industry: "", domain: "", country: "" });
        setLeads([BLANK_LEAD()]);
        setBatchName(""); setColor("violet");
      }
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setShowConfirm(false);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const previewLeads: PreviewLead[] = leads.map((l) => ({
    firstName: l.firstName, lastName: l.lastName,
    email: l.email, company: org.name, domain: org.domain, jobTitle: l.jobTitle,
  }));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {editMode ? "Edit organization and linked leads." : "Add leads under one organization."}
      </p>

      {/* Org */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Organization</p>
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Organization name <span className="text-destructive">*</span></Label>
            <Input value={org.name} onChange={(e) => setOrg((o) => ({ ...o, name: e.target.value }))} placeholder="Acme Plastics Ltd." />
          </div>
          <div className="space-y-1.5">
            <Label>Industry</Label>
            <Input value={org.industry} onChange={(e) => setOrg((o) => ({ ...o, industry: e.target.value }))} placeholder="Plastics manufacturing" />
          </div>
          <div className="space-y-1.5">
            <Label>Company website / domain <span className="text-destructive">*</span></Label>
            <Input value={org.domain} onChange={(e) => setOrg((o) => ({ ...o, domain: e.target.value }))} placeholder="acmeplastics.com" />
            <p className="text-[10px] text-muted-foreground/60">Used for Firecrawl enrichment</p>
          </div>
          <div className="space-y-1.5">
            <Label>Country</Label>
            <Input value={org.country} onChange={(e) => setOrg((o) => ({ ...o, country: e.target.value }))} placeholder="India" />
          </div>
        </div>
      </div>

      {/* People */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">People</p>
        {leads.map((lead, index) => (
          <div key={index} className="rounded-xl border border-border bg-card p-4 space-y-3 relative">
            {leads.length > 1 && (
              <button type="button" onClick={() => removeLead(index)} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors" aria-label="Remove lead">
                <X className="size-4" />
              </button>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>First name <span className="text-destructive">*</span></Label>
                <Input value={lead.firstName} onChange={(e) => updateLead(index, "firstName", e.target.value)} placeholder="Raj" />
              </div>
              <div className="space-y-1.5">
                <Label>Last name</Label>
                <Input value={lead.lastName} onChange={(e) => updateLead(index, "lastName", e.target.value)} placeholder="Sharma" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={lead.email} onChange={(e) => updateLead(index, "email", e.target.value)} placeholder="raj@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Job title</Label>
              <Input value={lead.jobTitle} onChange={(e) => updateLead(index, "jobTitle", e.target.value)} placeholder="VP Procurement" />
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" className="gap-1.5 w-full" onClick={addLead}>
          <Plus className="size-3.5" /> Add lead
        </Button>
      </div>

      {!editMode && (
        <BatchNameField
          value={batchName}
          onChange={(v) => { setBatchName(v); if (v.trim()) setBatchNameError(false); }}
          color={color}
          onColorChange={setColor}
          error={batchNameError}
        />
      )}

      {!editMode && <AssignToField employees={employees} value={assignTo} onChange={setAssignTo} />}

      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="button" disabled={saving} onClick={handleOpenConfirm}>
        {saving ? "Saving…" : editMode ? "Save changes" : "Preview & Save"}
      </Button>
      {saved && <p className="text-sm text-green-400">Saved successfully.</p>}

      {showConfirm && (
        <BatchConfirmModal
          source="manual"
          leads={previewLeads}
          totalCount={leads.length}
          confirming={saving}
          onConfirm={() => { void handleSaveAll(); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
