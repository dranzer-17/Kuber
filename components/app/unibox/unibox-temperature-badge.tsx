"use client";

import { Flame, Snowflake } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md shrink-0",
        badge.cls,
        className,
      )}
    >
      {icon}
      {badge.label}
    </Badge>
  );
}
