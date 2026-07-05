"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Loader2, Clock, Globe, Calendar, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DAY_LABELS, type Campaign } from "@/components/app/create-campaign-modal";
import { extractFollowupWaitsFromSteps, rebuildStepsWithFollowupWaits } from "@/lib/constants";
import { fetchCampaignSteps, patchCampaignConfig, saveCampaignSteps } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Bangkok",
  "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles",
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  const value = `${String(h).padStart(2, "0")}:${m}`;
  const period = h >= 12 ? "PM" : "AM";
  const dh = h % 12 || 12;
  return { value, label: `${String(dh).padStart(2, "0")}:${m} ${period}` };
});

function DayPill({ day, active, onClick }: { day: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "size-8 rounded-full text-xs font-semibold transition-colors border",
        active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-muted-foreground",
      )}
    >
      {day[0].toUpperCase()}
    </button>
  );
}

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-32 bg-transparent tabular-nums">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="center" className="min-w-32 max-h-56">
        {TIME_OPTIONS.map((t) => (
          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type FollowupStep = { delay: number; delay_unit: "minutes" | "hours" | "days" };

export function EditCampaignForm({
  campaign,
  onSaved,
  className,
}: {
  campaign: Campaign;
  onSaved?: (patch: Partial<Campaign>) => void;
  className?: string;
}) {
  const [senderName, setSenderName] = useState(campaign.senderName ?? "");
  const [aiPromptContext, setAiPromptContext] = useState(campaign.aiPromptContext ?? "");
  const [dailyLimit, setDailyLimit] = useState(campaign.dailyLimit ?? 30);
  const [windowFrom, setWindowFrom] = useState(campaign.windowFrom ?? "08:00");
  const [windowTo, setWindowTo] = useState(campaign.windowTo ?? "18:00");
  const [timezone, setTimezone] = useState(campaign.timezone ?? "Asia/Kolkata");
  const [sendDays, setSendDays] = useState<Record<string, boolean>>(
    campaign.sendDays ?? { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
  );
  const [followupSteps, setFollowupSteps] = useState<FollowupStep[]>([]);
  const [saving, setSaving] = useState(false);
  const [stepsLoading, setStepsLoading] = useState(true);

  // Reset + load steps whenever campaign changes
  useEffect(() => {
    setSenderName(campaign.senderName ?? "");
    setAiPromptContext(campaign.aiPromptContext ?? "");
    setDailyLimit(campaign.dailyLimit ?? 30);
    setWindowFrom(campaign.windowFrom ?? "08:00");
    setWindowTo(campaign.windowTo ?? "18:00");
    setTimezone(campaign.timezone ?? "Asia/Kolkata");
    setSendDays(campaign.sendDays ?? { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false });

    async function loadSteps() {
      setStepsLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { steps } = await fetchCampaignSteps(session.access_token, campaign.id);
        const followups = extractFollowupWaitsFromSteps(steps);
        setFollowupSteps(followups.length > 0 ? followups : [{ delay: 30, delay_unit: "days" }]);
      } catch {
        setFollowupSteps([{ delay: 30, delay_unit: "days" }]);
      } finally {
        setStepsLoading(false);
      }
    }
    void loadSteps();
  }, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // 1. Patch campaign config (schedule, limit, sender, AI context)
      const result = await patchCampaignConfig(session.access_token, campaign.id, {
        daily_limit: dailyLimit,
        window_from: windowFrom,
        window_to: windowTo,
        schedule_timezone: timezone,
        send_days: sendDays,
        sender_name: senderName || undefined,
        ai_prompt_context: aiPromptContext || undefined,
      });

      // 2. Rebuild steps — Instantly stores delay on step N as wait before step N+1
      const { steps: currentSteps } = await fetchCampaignSteps(session.access_token, campaign.id);
      const rebuilt = rebuildStepsWithFollowupWaits(currentSteps, followupSteps);

      await saveCampaignSteps(session.access_token, campaign.id, rebuilt);

      if (result.sync_errors.length > 0) {
        toast.warning("Saved, but Instantly sync had errors: " + result.sync_errors[0]);
      } else {
        toast.success("Campaign updated");
      }

      onSaved?.({ senderName, aiPromptContext, dailyLimit, windowFrom, windowTo, timezone, sendDays });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("space-y-6", className)}>
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Sender name</Label>
        <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Kuber Polyplast" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Additional context for AI</Label>
        <Textarea
          value={aiPromptContext}
          onChange={(e) => setAiPromptContext(e.target.value)}
          placeholder="e.g. Mention our new biodegradable masterbatch line. Focus on sustainability angle."
          rows={3}
        />
      </div>

      <div className="rounded-2xl border border-border bg-card/60 shadow-sm overflow-hidden divide-y divide-border">

            {/* Daily limit */}
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <Gauge className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium leading-none">Daily limit</p>
                  <p className="text-xs text-muted-foreground">Emails sent per day across all senders</p>
                </div>
              </div>
              <Input
                type="number"
                min={1}
                max={500}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(Math.max(1, Math.min(500, Number(e.target.value))))}
                className="h-9 w-20 text-center"
              />
            </div>

            {/* Sending window */}
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <Clock className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium leading-none">Sending window</p>
                  <p className="text-xs text-muted-foreground">Local time of recipient</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TimeSelect value={windowFrom} onChange={setWindowFrom} />
                <span className="text-xs text-muted-foreground">to</span>
                <TimeSelect value={windowTo} onChange={setWindowTo} />
              </div>
            </div>

            {/* Timezone */}
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <Globe className="size-4 text-muted-foreground shrink-0" />
                <p className="text-sm font-medium leading-none">Timezone</p>
              </div>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="h-9 w-45 bg-transparent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end" className="min-w-45">
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Send days */}
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <Calendar className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium leading-none">Send days</p>
                  <p className="text-xs text-muted-foreground">Days emails will be sent</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {DAYS.map((day) => (
                  <DayPill
                    key={day}
                    day={DAY_LABELS[day]}
                    active={sendDays[day] ?? false}
                    onClick={() => setSendDays((prev) => ({ ...prev, [day]: !prev[day] }))}
                  />
                ))}
              </div>
            </div>

            {/* Follow-up schedule */}
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <Clock className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium leading-none">Follow-up schedule</p>
                  <p className="text-xs text-muted-foreground">Wait time after the previous email before each follow-up sends</p>
                </div>
              </div>
              {stepsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Loading steps…
                </div>
              ) : (
                <div className="space-y-2">
                  {followupSteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                      <span className="text-xs text-muted-foreground shrink-0 w-24">Follow-up {idx + 1} after</span>
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        value={step.delay}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                          setFollowupSteps((prev) => prev.map((s, i) => i === idx ? { ...s, delay: v } : s));
                        }}
                        className="h-7 w-16 text-center border-0 bg-transparent p-0 text-sm font-medium focus-visible:ring-0"
                      />
                      <Select
                        value={step.delay_unit}
                        onValueChange={(unit) =>
                          setFollowupSteps((prev) =>
                            prev.map((s, i) => i === idx ? { ...s, delay_unit: unit as FollowupStep["delay_unit"] } : s),
                          )
                        }
                      >
                        <SelectTrigger className="h-7 w-fit min-w-0 justify-start gap-1 border-0 bg-transparent px-1 text-xs text-muted-foreground shadow-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start" className="min-w-24">
                          <SelectItem value="minutes">minutes</SelectItem>
                          <SelectItem value="hours">hours</SelectItem>
                          <SelectItem value="days">days</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex-1" />
                      {followupSteps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setFollowupSteps((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-xs text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {followupSteps.length < 8 && (
                    <button
                      type="button"
                      onClick={() =>
                        setFollowupSteps((prev) => {
                          const last = prev[prev.length - 1];
                          return [...prev, { delay: (last?.delay ?? 0) + 30, delay_unit: last?.delay_unit ?? "days" }];
                        })
                      }
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      + Add follow-up step
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

      <div className="flex justify-end">
        <Button disabled={saving} onClick={() => void handleSave()} className="gap-1.5">
          {saving ? (
            <><Loader2 className="size-3.5 animate-spin" /> Saving…</>
          ) : (
            <>Save changes <ChevronRight className="size-3.5" /></>
          )}
        </Button>
      </div>
    </div>
  );
}

export function EditCampaignModal({
  open,
  onClose,
  campaign,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
  onSaved?: (patch: Partial<Campaign>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl overflow-hidden border-border bg-background p-0 shadow-2xl">
        <DialogHeader className="border-b border-border px-6 pt-6 pb-4 text-left">
          <p className="text-xs text-muted-foreground mb-1">Editing · {campaign.name}</p>
          <DialogTitle className="text-xl">Edit campaign</DialogTitle>
        </DialogHeader>

        <div className="max-h-[68vh] overflow-y-auto px-6 py-5">
          <EditCampaignForm
            campaign={campaign}
            onSaved={(patch) => {
              onSaved?.(patch);
              onClose();
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
