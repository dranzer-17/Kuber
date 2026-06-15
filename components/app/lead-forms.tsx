"use client";

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AlertCircle, CheckCircle2, FileText, Plus, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ALLOWED_KEYWORDS, LOCATION_MAP, APOLLO_TITLES, APOLLO_SENIORITIES } from "@/lib/constants";
import { apolloPreview, importExcelDirect, createLead, patchLead, patchOrg, type PreviewLead } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { BatchConfirmModal } from "@/components/app/batch-confirm-modal";

// ─── TagInput ─────────────────────────────────────────────────────────────────

export function TagInput({
  label,
  pills,
  suggestions,
  onChange,
  placeholder,
  allowCustom = true,
  max,
  required,
}: {
  label: string;
  pills: string[];
  suggestions: readonly string[];
  onChange: (pills: string[]) => void;
  placeholder?: string;
  allowCustom?: boolean;
  max?: number;
  required?: boolean;
}) {
  const [query,     setQuery] = useState("");
  const [open,      setOpen ] = useState(false);
  const containerRef          = useRef<HTMLDivElement>(null);
  const inputRef              = useRef<HTMLInputElement>(null);

  const maxReached = max !== undefined && pills.length >= max;
  const q = query.trim().toLowerCase();
  const filtered = suggestions.filter((s) => s.toLowerCase().includes(q) && !pills.includes(s));
  const exactMatch = suggestions.some((s) => s.toLowerCase() === q);
  const canAddCustom = allowCustom && q.length > 0 && !exactMatch && !pills.includes(query.trim());

  function add(value: string) {
    const v = value.trim();
    if (!v || pills.includes(v) || maxReached) return;
    onChange([...pills, v]);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }
  function remove(value: string) { onChange(pills.filter((p) => p !== value)); }
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "Enter" || e.key === ",") && query.trim() && !maxReached) {
      e.preventDefault();
      if (filtered.length > 0 && !canAddCustom) add(filtered[0]);
      else if (allowCustom) add(query.trim());
    }
    if (e.key === "Backspace" && !query && pills.length > 0) onChange(pills.slice(0, -1));
    if (e.key === "Escape") setOpen(false);
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const showDropdown = open && !maxReached && (filtered.length > 0 || canAddCustom);

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <Label>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <div
        className="relative min-h-9 flex flex-wrap gap-1.5 items-center rounded-md border border-input bg-transparent px-3 py-2 cursor-text focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-shadow"
        onClick={() => !maxReached && inputRef.current?.focus()}
      >
        {pills.map((p) => (
          <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-xs font-medium text-primary">
            {p}
            <button type="button" onClick={(e) => { e.stopPropagation(); remove(p); }} className="hover:text-destructive transition-colors">
              <X className="size-2.5" />
            </button>
          </span>
        ))}
        {!maxReached && (
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={pills.length === 0 ? (placeholder ?? "Type to search…") : ""}
            className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
        )}
      </div>
      {showDropdown && (
        <div className="relative z-50">
          <div className="absolute top-0 left-0 right-0 rounded-md border border-border bg-popover shadow-lg overflow-hidden max-h-48 overflow-y-auto">
            {filtered.map((s) => (
              <button key={s} type="button" onMouseDown={(e) => { e.preventDefault(); add(s); }} className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors">
                {s}
              </button>
            ))}
            {canAddCustom && (
              <button type="button" onMouseDown={(e) => { e.preventDefault(); add(query.trim()); }} className="w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors flex items-center gap-2 text-muted-foreground border-t border-border">
                <Plus className="size-3.5 shrink-0" />
                Add &ldquo;{query.trim()}&rdquo;
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

// ─── Apollo ───────────────────────────────────────────────────────────────────

export function ApolloForm({ onImport }: { onImport: (n: number) => void }) {
  const [keywords,     setKeywords    ] = useState<string[]>([]);
  const [positions,    setPositions   ] = useState<string[]>([]);
  const [seniorities,  setSeniorities ] = useState<string[]>([]);
  const [locations,    setLocations   ] = useState<string[]>([]);
  const [maxPages,     setMaxPages    ] = useState(1);
  const [previewing,   setPreviewing  ] = useState(false);
  const [confirming,   setConfirming  ] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [previewLeads, setPreviewLeads] = useState<PreviewLead[] | null>(null);
  const [result,       setResult      ] = useState<{ inserted: number; skipped: number } | null>(null);
  const [error,        setError       ] = useState("");

  function toggleSen(s: string) {
    setSeniorities((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    if (keywords.length === 0) { setError("Please select an industry keyword."); return; }
    setError("");
    setPreviewing(true);
    try {
      const token = await getToken();
      const res = await apolloPreview(token, {
        keywords,
        locations: locations.map((l) => LOCATION_MAP[l] ?? l),
        max_pages: maxPages,
        titles: positions.length > 0 ? positions : [...APOLLO_TITLES],
        seniorities: seniorities.length > 0 ? seniorities : undefined,
        batch_name: "_preview_",
      });
      setPreviewLeads(res.leads);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm(batchName: string, color: string) {
    setConfirming(true);
    setProgressText("Starting…");
    try {
      const token = await getToken();
      const response = await fetch("/api/v1/leads/apollo-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          keywords,
          locations: locations.map((l) => LOCATION_MAP[l] ?? l),
          max_pages: maxPages,
          titles: positions.length > 0 ? positions : [...APOLLO_TITLES],
          seniorities: seniorities.length > 0 ? seniorities : undefined,
          batch_name: batchName,
          color,
        }),
      });

      if (!response.ok || !response.body) throw new Error(`Request failed: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: { inserted: number; skipped: number } | null = null;
      let finalError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.phase === "saving") {
              setProgressText(`Saving ${data.saved} of ${data.total} leads…`);
            } else if (data.phase === "enriching") {
              setProgressText(data.enriched === 0
                ? `Enriching ${data.total} leads…`
                : `Enriching ${data.enriched} of ${data.total}…`);
            } else if (data.phase === "done") {
              finalResult = { inserted: data.result.inserted, skipped: data.result.skipped };
            } else if (data.phase === "error") {
              finalError = data.message;
            }
          } catch { /* ignore malformed events */ }
        }
      }

      setPreviewLeads(null);
      if (finalError) throw new Error(finalError);
      if (finalResult) {
        setResult(finalResult);
        if (finalResult.inserted > 0) onImport(finalResult.inserted);
      }
    } catch (e) {
      setPreviewLeads(null);
      setError((e as Error).message);
    } finally {
      setConfirming(false);
      setProgressText("");
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Search Apollo&apos;s database to find plastic &amp; polymer industry leads.
      </p>
      <form onSubmit={handlePreview} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <TagInput
            label="Industry Keywords"
            pills={keywords}
            suggestions={ALLOWED_KEYWORDS}
            onChange={setKeywords}
            placeholder="e.g. plastics, polymer…"
            required
          />
          <div className="space-y-1.5">
            <Label>Pages to fetch (50 leads/page)</Label>
            <Select value={String(maxPages)} onValueChange={(v) => setMaxPages(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1,2,3,5,10].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} page{n > 1 ? "s" : ""} (~{n * 50} leads)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <TagInput label="Positions / Job Titles" pills={positions} suggestions={APOLLO_TITLES} onChange={setPositions} placeholder="e.g. VP, Plant Manager…" />

        <div className="space-y-1.5">
          <Label>Seniority</Label>
          <div className="flex flex-wrap gap-1.5">
            {APOLLO_SENIORITIES.map((s) => (
              <button
                key={s} type="button" onClick={() => toggleSen(s)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-full border transition-colors",
                  seniorities.includes(s) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground",
                )}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Locations</Label>
          <Select value="" onValueChange={(v) => { if (v && !locations.includes(v)) setLocations((p) => [...p, v]); }}>
            <SelectTrigger><SelectValue placeholder="Select a country…" /></SelectTrigger>
            <SelectContent className="max-h-60 overflow-y-auto">
              {Object.keys(LOCATION_MAP).filter((loc) => !locations.includes(loc)).map((loc) => (
                <SelectItem key={loc} value={loc}>{loc}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {locations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {locations.map((loc) => (
                <span key={loc} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-xs font-medium text-primary">
                  {loc}
                  <button type="button" onClick={() => setLocations((p) => p.filter((l) => l !== loc))} className="hover:text-destructive transition-colors">
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <Button type="submit" disabled={previewing || keywords.length === 0} className="gap-1.5" title={keywords.length === 0 ? "Add at least one keyword" : undefined}>
          <Search className="size-3.5" />
          {previewing ? "Loading preview…" : "Preview leads"}
        </Button>
      </form>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5">
          <AlertCircle className="size-3.5 shrink-0" /> {error}
        </div>
      )}
      {result !== null && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 space-y-1">
          <p className="text-sm font-semibold text-green-400">{result.inserted} leads imported</p>
          <p className="text-xs text-muted-foreground">{result.skipped} duplicates skipped</p>
        </div>
      )}

      {previewLeads !== null && (
        <BatchConfirmModal
          source="apollo"
          leads={previewLeads}
          totalCount={maxPages * 50}
          confirming={confirming}
          progressText={progressText}
          onConfirm={handleConfirm}
          onCancel={() => setPreviewLeads(null)}
        />
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
  const [importing,   setImporting  ] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result,      setResult     ] = useState<ParseResult | null>(null);
  const [fileError,   setFileError  ] = useState("");

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

  async function handleConfirm(batchName: string, color: string) {
    setImporting(true);
    try {
      const token = await getToken();
      const res = await importExcelDirect(token, rows, mapping, batchName, color);
      setShowConfirm(false);
      setResult(res);
      setStage("result");
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
    setResult(null); setFileError("");
  }

  const previewLeads: PreviewLead[] = rows.slice(0, 5).map((row) => ({
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
          <Button variant="ghost" size="sm" className="shrink-0" onClick={reset}>Change</Button>
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
                  <SelectTrigger className={cn("h-8 text-xs", mapped && "border-primary/40 bg-primary/5")}>
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

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{rows.length} rows will be processed</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reset}>Back</Button>
            <Button disabled={!emailMapped || !firstNameMapped || !domainMapped || importing} onClick={() => setShowConfirm(true)}>
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
            onConfirm={handleConfirm}
            onCancel={() => setShowConfirm(false)}
          />
        )}
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
          { label: "Duplicates removed",   value: (result?.skipped_duplicate_in_file ?? 0) + (result?.skipped_duplicate_in_db ?? 0), accent: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
          { label: "Blank emails skipped", value: result?.skipped_blank_email,   accent: "text-zinc-400", bg: "bg-zinc-500/10",  border: "border-zinc-500/20"  },
          { label: "Invalid format",       value: result?.skipped_invalid_email, accent: "text-red-400",  bg: "bg-red-500/10",   border: "border-red-500/20"   },
        ].map(({ label, value, accent, bg, border }) => (
          <div key={label} className={cn("rounded-lg border px-3 py-3 text-center", bg, border)}>
            <p className={cn("text-xl font-bold tabular-nums", accent)}>{value ?? 0}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
          </div>
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
  const [saving,      setSaving     ] = useState(false);
  const [saved,       setSaved      ] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error,       setError      ] = useState("");

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
      handleSaveAll("edit", "violet");
    } else {
      setShowConfirm(true);
    }
  }

  async function handleSaveAll(batchName: string, color: string) {
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
            // all leads in this batch share one import row
            ...(sharedImportId ? { import_id: sharedImportId } : { batch_name: batchName, color }),
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
      <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Organization</p>
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
          onConfirm={handleSaveAll}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
