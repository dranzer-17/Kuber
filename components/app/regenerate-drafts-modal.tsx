"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, RotateCcw, Loader2, Lock } from "lucide-react";
import type { RegenerationSkipped } from "@/lib/api-client";

interface RegenerateDraftsModalProps {
  /** Eligible drafts split by current state — what will actually be rewritten. */
  counts: { draft: number; failed: number };
  /** What the run will leave alone, and why. */
  skipped: RegenerationSkipped;
  /** True when the user ticked specific leads rather than targeting the whole campaign. */
  isSubset: boolean;
  submitting?: boolean;
  onConfirm: (instruction: string) => void;
  onCancel: () => void;
}

export function RegenerateDraftsModal(props: RegenerateDraftsModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(<RegenerateDraftsModalInner {...props} />, document.body);
}

function RegenerateDraftsModalInner({
  counts,
  skipped,
  isSubset,
  submitting,
  onConfirm,
  onCancel,
}: RegenerateDraftsModalProps) {
  const [instruction, setInstruction] = useState("");
  const total = counts.draft + counts.failed;

  const protectedRows = [
    { n: skipped.certified, label: "Certified", note: "left untouched — regenerate individually if needed" },
    { n: skipped.sent,      label: "Sent",      note: "already delivered" },
    { n: skipped.no_draft,  label: "No draft",  note: "nothing to regenerate yet" },
  ].filter((r) => r.n > 0);

  return (
    // `data-confirm-dialog-root` + forced `pointer-events-auto`: this portals to
    // document.body while the campaign drawer (a Radix Dialog) is open behind it,
    // and Radix sets `pointer-events: none` on <body> while open — without this
    // every button here is unclickable. Same treatment as batch-confirm-modal.
    <div data-confirm-dialog-root className="fixed inset-0 z-200 flex items-center justify-center pointer-events-auto">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={submitting ? undefined : onCancel} />

      <div className="enter swatch-bar-top overflow-hidden relative z-10 w-full max-w-lg mx-4 rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[90vh]">

        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <p className="eyebrow">Bulk action</p>
            <h2 className="font-display text-base font-semibold mt-0.5">
              Regenerate <span className="font-mono tabular-nums">{total}</span> draft{total !== 1 ? "s" : ""}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each lead gets a fresh AI draft. The current wording is kept in Version history.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCancel}
            disabled={submitting}
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-6 py-4 space-y-2.5">
            <p className="eyebrow">
              {isSubset ? "Selected leads" : "Will be regenerated"}
            </p>
            {counts.draft > 0 && (
              <CountRow n={counts.draft} label="Draft" note="rewritten with your instruction" />
            )}
            {counts.failed > 0 && (
              <CountRow n={counts.failed} label="Failed" note="retried from scratch" />
            )}
          </div>

          {protectedRows.length > 0 && (
            <div className="px-6 py-4 border-t border-border bg-secondary/20 space-y-2.5">
              <p className="eyebrow flex items-center gap-1.5">
                <Lock className="size-3" /> Protected — not touched
              </p>
              {protectedRows.map((r) => (
                <CountRow key={r.label} n={r.n} label={r.label} note={r.note} muted />
              ))}
            </div>
          )}

          <div className="px-6 py-4 border-t border-border space-y-2">
            <p className="eyebrow">Instruction (optional)</p>
            <Input
              value={instruction}
              autoFocus
              disabled={submitting}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !submitting) onConfirm(instruction.trim()); }}
              placeholder="e.g. Make it shorter and less salesy"
            />
            <p className="text-[11px] text-muted-foreground">
              Applied to every draft in this run only — the campaign&apos;s saved AI context is unchanged.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border shrink-0">
          <p className="text-[11px] text-muted-foreground">
            Runs in the background — safe to close.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => onConfirm(instruction.trim())} disabled={submitting || total === 0}>
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
              Regenerate {total}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CountRow({ n, label, note, muted }: { n: number; label: string; note: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 text-xs">
      <span className={`font-mono tabular-nums w-8 text-right shrink-0 ${muted ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
        {n}
      </span>
      <span className={`w-20 shrink-0 ${muted ? "text-muted-foreground" : "font-medium text-foreground"}`}>{label}</span>
      <span className="text-muted-foreground min-w-0">{note}</span>
    </div>
  );
}
