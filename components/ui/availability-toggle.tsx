"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import type { AvailabilityStatus } from "@/lib/api-client";

type AvailabilityToggleProps = {
  status: AvailabilityStatus | null;
  disabled?: boolean;
  onToggle: () => void;
  /** Show "Available" / "Away" text beside the switch. Default true. */
  showLabel?: boolean;
  className?: string;
};

/**
 * Availability control — green when online (available for auto-assignment).
 */
export function AvailabilityToggle({
  status,
  disabled = false,
  onToggle,
  showLabel = true,
  className,
}: AvailabilityToggleProps) {
  const id = useId();
  const ready = status !== null;
  const isAvailable = status === "online";
  const isAway = status === "offline";

  return (
    <div className={cn("flex items-center gap-2.5 shrink-0", className)}>
      {showLabel && (
        <span
          id={`${id}-label`}
          className={cn(
            "text-xs font-medium tabular-nums",
            !ready && "text-muted-foreground",
            isAvailable && "text-emerald-600 dark:text-emerald-400",
            isAway && "text-amber-600 dark:text-amber-400",
          )}
        >
          {!ready ? "…" : isAvailable ? "Available" : "Away"}
        </span>
      )}
      <Switch
        id={id}
        tone="success"
        checked={isAvailable}
        disabled={disabled || !ready}
        onCheckedChange={() => onToggle()}
        aria-labelledby={showLabel ? `${id}-label` : undefined}
        aria-label={
          showLabel
            ? undefined
            : isAvailable
              ? "Mark away — exclude from automatic lead assignments"
              : "Mark available — include in automatic lead assignments"
        }
      />
    </div>
  );
}
