"use client";

import { AlertTriangle, Pause, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Label for the confirming action. Defaults to "Delete". */
  confirmLabel?: string;
  /** Visual tone of the confirm action. "destructive" (red) is the default; use "warning" (amber) for non-destructive but disruptive actions like pausing. */
  tone?: "destructive" | "warning";
  loading?: boolean;
  /** Blocks confirming without showing the loading spinner. */
  confirmDisabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Destructive confirmation modal.
 *
 * Deliberately not built on the Radix `Dialog` primitive: it renders above
 * drawers (z-50/z-60), so it needs its own z-[200] overlay.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  tone = "destructive",
  loading,
  confirmDisabled,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;

  const isWarning = tone === "warning";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => { if (!loading) onClose(); }}
      />
      <div className="enter relative z-10 w-full max-w-sm mx-4 swatch-bar-top overflow-hidden rounded-2xl border border-border bg-card shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <div className={`shrink-0 size-10 rounded-full flex items-center justify-center ${isWarning ? "bg-amber-500/15 border border-amber-500/25" : "bg-destructive/15 border border-destructive/25"}`}>
            <AlertTriangle className={`size-5 ${isWarning ? "text-amber-500" : "text-destructive"}`} />
          </div>
          <div>
            <p className="font-display font-semibold text-sm">{title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" variant={isWarning ? "warning" : "destructive"} onClick={onConfirm} disabled={loading || confirmDisabled} className="gap-2">
            {loading ? <RefreshCw className="animate-spin" /> : isWarning ? <Pause /> : <Trash2 />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
