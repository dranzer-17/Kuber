import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  KANBAN_STAGES,
  STEP_DESCRIPTIONS,
  STATUS_ORDER,
  STATUS_LABELS,
  type LeadScore,
  type LeadStatus,
} from "@/lib/leads";

const STATUS_STYLES: Record<LeadStatus, string> = {
  "Input Required": "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  New:      "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
  Enriching:"bg-amber-500/15 text-amber-400 border-amber-500/25",
  Enriched: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  Open:     "bg-green-500/15 text-green-400 border-green-500/25",
  Closed:   "bg-zinc-500/15 text-zinc-300 border-zinc-500/25",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border", STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ScoreBadge({ score }: { score: LeadScore }) {
  if (score === "—") return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border",
      score === "Hot" ? "bg-orange-500/15 text-orange-400 border-orange-500/25" : "bg-blue-500/15 text-blue-400 border-blue-500/25"
    )}>
      {score}
    </span>
  );
}

export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className={cn(
      "rounded-full bg-secondary border border-border flex items-center justify-center font-semibold text-foreground shrink-0",
      size === "sm" && "size-8 text-xs",
      size === "md" && "size-10 text-sm",
      size === "lg" && "size-14 text-base",
    )}>
      {initials}
    </div>
  );
}

const STEPPER_STAGES: LeadStatus[] = ["New", "Enriched"];

export function PipelineStepper({ currentStatus }: { currentStatus: LeadStatus }) {
  const stepperStatus: LeadStatus =
    currentStatus === "Input Required" || currentStatus === "New" || currentStatus === "Enriching" ? "New"
    : "Enriched";
  const current = STEPPER_STAGES.indexOf(stepperStatus);
  return (
    <div>
      {STEPPER_STAGES.map((stage, i) => {
        const done = i <= current;
        const active = i === current;
        const last = i === STEPPER_STAGES.length - 1;
        return (
          <div key={stage} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn(
                "size-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
                done && "bg-primary border-primary",
                active && "border-primary",
                !done && !active && "border-border",
              )}>
                {done
                  ? <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />
                  : <span className={cn("text-[10px] font-bold", active ? "text-primary" : "text-muted-foreground/30")}>{i + 1}</span>}
              </div>
              {!last && <div className={cn("w-px flex-1 my-1", (done && !active) ? "bg-primary" : "bg-border")} />}
            </div>
            <div className={cn("pb-4", last && "pb-0")}>
              <p className={cn(
                "text-xs font-semibold",
                active ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/40",
              )}>
                {stage}
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">{STEP_DESCRIPTIONS[stage]}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
