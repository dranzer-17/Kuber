"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BATCH_COLORS, getBatchColor } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Users, AlertCircle } from "lucide-react";
import type { PreviewLead } from "@/lib/api-client";

interface BatchConfirmModalProps {
  source: "apollo" | "excel" | "manual";
  leads: PreviewLead[];
  totalCount?: number;
  confirming?: boolean;
  progressText?: string;
  onConfirm: (batchName: string, color: string) => void;
  onCancel: () => void;
}

export function BatchConfirmModal(props: BatchConfirmModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(<BatchConfirmModalInner {...props} />, document.body);
}

function BatchConfirmModalInner({
  source,
  leads,
  totalCount,
  confirming,
  progressText,
  onConfirm,
  onCancel,
}: BatchConfirmModalProps) {
  const [batchName,      setBatchName     ] = useState("");
  const [color,          setColor         ] = useState("violet");
  const [nameError,      setNameError     ] = useState(false);
  const [swatchOpen,     setSwatchOpen    ] = useState(false);
  const swatchRef                           = useRef<HTMLDivElement>(null);

  const c           = getBatchColor(color);
  const sourceLabel = source === "apollo" ? "Apollo Search" : source === "excel" ? "Excel / CSV" : "Manual Entry";
  const extra       = totalCount && totalCount > leads.length ? totalCount - leads.length : 0;

  // close swatch on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (swatchRef.current && !swatchRef.current.contains(e.target as Node)) setSwatchOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleConfirm() {
    if (!batchName.trim()) { setNameError(true); return; }
    onConfirm(batchName.trim(), color);
  }

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative z-10 w-full max-w-xl mx-4 rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-sm font-bold">Preview & Confirm Import</p>
            <p className="text-xs text-muted-foreground mt-0.5">{sourceLabel} · name your batch before confirming</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-secondary"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Batch name + colour — single row */}
        <div className="px-6 py-4 border-b border-border shrink-0 bg-secondary/20">
          <div className="flex items-end gap-3">

            {/* left: batch name */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Batch Name</span>
                <span className="text-destructive text-xs">*</span>
                {batchName.trim() && (
                  <span className={cn("ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium", c.pill)}>
                    <span className={cn("size-1.5 rounded-full shrink-0", c.bg)} />
                    {batchName}
                  </span>
                )}
              </div>
              <Input
                autoFocus
                value={batchName}
                onChange={(e) => { setBatchName(e.target.value); if (e.target.value.trim()) setNameError(false); }}
                placeholder="e.g. India Plastics Q3…"
                className={cn("h-8 text-sm", nameError && "border-destructive focus-visible:ring-destructive")}
              />
              {nameError && (
                <p className="text-[10px] text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3 shrink-0" /> Batch name is required
                </p>
              )}
            </div>

            {/* right: pick colour */}
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

              {/* colour palette dropdown — 4×2 */}
              {swatchOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-10 rounded-xl border border-border bg-popover shadow-xl p-3.5 grid grid-cols-4 gap-3.5 w-[188px]">
                  {BATCH_COLORS.map((bc) => (
                    <button
                      key={bc.name}
                      type="button"
                      title={bc.name}
                      onClick={() => { setColor(bc.name); setSwatchOpen(false); }}
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

        {/* Lead count */}
        {totalCount !== undefined && (
          <div className="px-6 py-2.5 border-b border-border shrink-0 flex items-center gap-1.5 bg-secondary/10">
            <Users className="size-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {totalCount} lead{totalCount !== 1 ? "s" : ""} will be imported
              {source === "apollo" && " (emails enriched post-import)"}
            </span>
          </div>
        )}

        {/* Lead preview table */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-2 px-6">
              <p className="text-sm font-medium">No preview available</p>
              {source === "apollo" && (
                <p className="text-xs text-muted-foreground max-w-xs">
                  Apollo emails are revealed after import and enrichment.
                </p>
              )}
            </div>
          ) : (
            <table className="w-full text-xs table-fixed">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[24%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr>
                  {["Name", "Email", "Organisation", "Domain", "Job Title"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((l, i) => (
                  <tr key={i} className="hover:bg-secondary/30 transition-colors align-top">
                    <td className="px-3 py-2.5 font-medium leading-snug wrap-break-word">
                      {[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground font-mono truncate max-w-0">{l.email || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground truncate max-w-0">{l.company || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground truncate max-w-0">{l.domain || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground truncate max-w-0">{l.jobTitle || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {extra > 0 && (
            <p className="px-4 py-2.5 text-[10px] text-muted-foreground border-t border-border">
              +{extra} more lead{extra !== 1 ? "s" : ""} will be imported
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={confirming}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={confirming}>
            {confirming ? (progressText || "Importing…") : "Confirm & Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
