export type TemperatureKey = "hot" | "warm" | "cold" | "neutral" | "ooo" | "unsubscribed";

export const TEMPERATURE_BADGE: Record<
  TemperatureKey,
  { label: string; cls: string }
> = {
  hot: { label: "HOT", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  warm: { label: "WARM", cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  cold: { label: "COLD", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  neutral: { label: "NEUTRAL", cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
  ooo: { label: "OUT OF OFFICE", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  unsubscribed: { label: "UNSUBSCRIBED", cls: "bg-zinc-700/40 text-zinc-500 border-zinc-600/30" },
};

export function temperatureBadge(temp: string | null | undefined): { label: string; cls: string } {
  const key = (temp ?? "neutral") as TemperatureKey;
  return TEMPERATURE_BADGE[key] ?? TEMPERATURE_BADGE.neutral;
}
