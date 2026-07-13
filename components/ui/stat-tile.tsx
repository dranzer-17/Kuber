import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type StatTileTone = "neutral" | "red" | "sky" | "amber" | "zinc";

const TONE_ICON: Record<StatTileTone, string> = {
  neutral: "bg-primary/10 border-primary/20 text-primary",
  red: "bg-red-500/10 border-red-500/20 text-red-400",
  sky: "bg-sky-500/10 border-sky-500/20 text-sky-400",
  amber: "bg-amber-500/10 border-amber-500/20 text-amber-400",
  zinc: "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
};

const TONE_TEXT: Record<StatTileTone, string> = {
  neutral: "",
  red: "text-red-400",
  sky: "text-sky-400",
  amber: "text-amber-400",
  zinc: "text-zinc-400",
};

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Renders an icon badge above the value instead of a centered text-only layout. */
  icon?: LucideIcon;
  sub?: string;
  /** Tints the icon badge and value text for a semantic outcome. Omit for the neutral default. */
  tone?: StatTileTone;
  className?: string;
}

export function StatTile({ label, value, icon: Icon, sub, tone = "neutral", className }: StatTileProps) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-3", Icon ? "flex flex-col gap-2" : "text-center py-3", className)}>
      {Icon && (
        <div className={cn("size-7 rounded-lg flex items-center justify-center border", TONE_ICON[tone])}>
          <Icon className="size-3.5" />
        </div>
      )}
      <div>
        <p className={cn("text-xl font-bold tabular-nums leading-tight", TONE_TEXT[tone])}>{value}</p>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-1">{label}</p>
        {sub && <p className="text-[9px] text-muted-foreground/60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
