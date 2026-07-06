"use client";

import { Flame, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";
import { temperatureBadge } from "@/lib/temperature-badge";

type Props = {
  temperature: string | null | undefined;
  className?: string;
};

const ICONS: Partial<Record<string, React.ReactNode>> = {
  hot: <Flame className="size-3" />,
  cold: <Snowflake className="size-3" />,
};

export function UniboxTemperatureBadge({ temperature, className }: Props) {
  const badge = temperatureBadge(temperature);
  const icon = ICONS[temperature ?? ""] ?? null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold uppercase px-2.5 py-1 rounded-full border shrink-0",
        badge.cls,
        className,
      )}
    >
      {icon}
      {badge.label}
    </span>
  );
}
