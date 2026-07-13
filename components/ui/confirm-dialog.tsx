"use client";

import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** Label for the confirming action. Defaults to "Delete". */
  confirmLabel?: string;
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
  loading,
  confirmDisabled,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => { if (!loading) onClose(); }}
      />
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-2xl border border-border bg-card shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <div className="shrink-0 size-10 rounded-full bg-destructive/15 border border-destructive/25 flex items-center justify-center">
            <AlertTriangle className="size-5 text-destructive" />
          </div>
          <div>
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={loading || confirmDisabled} className="gap-2">
            {loading ? <RefreshCw className="animate-spin" /> : <Trash2 />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
