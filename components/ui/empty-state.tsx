import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  message: React.ReactNode;
  icon?: LucideIcon;
  /**
   * Renders the message inside its own panel. Turn this off when the empty
   * state already sits inside a panel, table cell, or chart area — boxing it
   * there would nest a card inside a card.
   */
  boxed?: boolean;
  className?: string;
  /** Optional call to action rendered under the message. */
  children?: React.ReactNode;
}

export function EmptyState({
  message,
  icon: Icon,
  boxed = true,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        boxed
          ? "rounded-xl border border-border bg-card shadow-sm px-6 py-16"
          : "py-12",
        className,
      )}
    >
      {Icon && <Icon className="size-5 text-muted-foreground" />}
      <p className="text-sm text-muted-foreground">{message}</p>
      {children}
    </div>
  );
}
