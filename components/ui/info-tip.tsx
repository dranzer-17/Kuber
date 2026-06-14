"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function InfoTip({
  text,
  className,
  side = "top",
}: {
  text: string;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const [open, setOpen] = useState(false);

  const position =
    side === "bottom" ? "top-full mt-1.5" :
    side === "left" ? "right-full mr-1.5 top-1/2 -translate-y-1/2" :
    side === "right" ? "left-full ml-1.5 top-1/2 -translate-y-1/2" :
    "bottom-full mb-1.5";

  return (
    <span
      className={cn("relative inline-flex items-center", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        tabIndex={0}
        aria-label="More information"
        className="inline-flex items-center justify-center size-4 rounded-full text-muted-foreground hover:text-foreground transition-colors"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <Info className="size-3" />
      </button>
      {open && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50 w-52 rounded-lg border border-border bg-card px-2.5 py-2 text-[11px] leading-relaxed text-foreground shadow-lg pointer-events-none",
            position,
            side === "top" || side === "bottom" ? "left-1/2 -translate-x-1/2" : "",
          )}
        >
          {text}
        </span>
      )}
    </span>
  );
}
