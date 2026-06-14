"use client";

import { useState } from "react";
import { ChevronRight, Loader2, Clock, Calendar, Gauge, Globe, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InfoTip } from "@/components/ui/info-tip";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/leads";
import { isCampaignEligible, CAMPAIGN_ACTION_HELP } from "@/lib/leads";
import { createCampaign, addLeadsToCampaign, triggerDraftGeneration, mapDbCampaign } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

export type Campaign = {
  id: string;
  name: string;
  status: "Draft" | "Scheduled" | "Live" | "Paused";
  leads: number;
  sent: number;
  replied: number;
  humanInLoop: boolean;
  createdAt: string;
  instantlyId?: string | null;
  dailyLimit?: number;
  windowFrom?: string;
  windowTo?: string;
  timezone?: string;
  sendDays?: Record<string, boolean>;
};

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

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_LABELS: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Bangkok",
  "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles",
  "UTC",
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? "00" : "30";
  const value = `${String(hours).padStart(2, "0")}:${minutes}`;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  const label = `${String(displayHour).padStart(2, "0")}:${minutes} ${period}`;
  return { value, label };
});

function TimeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-32 bg-transparent tabular-nums">
        <SelectValue placeholder="Select time" />
      </SelectTrigger>
      <SelectContent align="center" className="min-w-32">
        {TIME_OPTIONS.map((time) => (
          <SelectItem key={time.value} value={time.value}>
            {time.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CreateCampaignModal({
  open, onClose, onCreated, leads,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Campaign) => void;
  leads: Lead[];
}) {
  const [name, setName] = useState("");
  const [humanInLoop, setHumanInLoop] = useState(true);
  const [dailyLimit, setDailyLimit] = useState(30);
  const [windowFrom, setWindowFrom] = useState("08:00");
  const [windowTo, setWindowTo] = useState("18:00");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [sendDays, setSendDays] = useState<Record<string, boolean>>({
    monday: true, tuesday: true, wednesday: true, thursday: true,
    friday: true, saturday: false, sunday: false,
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  function updateDailyLimit(nextValue: number) {
    setDailyLimit(Math.max(1, Math.min(500, nextValue)));
  }

  function reset() {
    setName(""); setHumanInLoop(true); setDailyLimit(30);
    setWindowFrom("08:00"); setWindowTo("18:00"); setTimezone("Asia/Kolkata");
    setSendDays({ monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false });
    setCreating(false); setError("");
  }

  function handleClose() { reset(); onClose(); }

  async function handleCreate() {
    setError("");
    const eligibleLeads = leads.filter(isCampaignEligible);
    if (eligibleLeads.length === 0) {
      setError("None of the selected leads have completed company enrichment. Only leads with a domain and finished Firecrawl can be added.");
      return;
    }
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";

      const dbCampaign = await createCampaign(token, {
        name,
        human_in_loop: humanInLoop,
        daily_limit: dailyLimit,
        window_from: windowFrom,
        window_to: windowTo,
        schedule_timezone: timezone,
        send_days: sendDays,
      });

      await addLeadsToCampaign(token, dbCampaign.id, eligibleLeads.map((l) => l.id));
      await triggerDraftGeneration(token, dbCampaign.id);

      const campaign = mapDbCampaign({ ...dbCampaign, total_leads: eligibleLeads.length });
      onCreated(campaign);
      handleClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-3xl overflow-hidden border-border bg-background p-0 shadow-2xl">
        <DialogHeader className="border-b border-border px-6 pt-6 pb-4 text-left">
          <p className="text-xs text-muted-foreground mb-1">
            New Campaign · {leads.length} lead{leads.length !== 1 ? "s" : ""} ready for outreach
          </p>
          <DialogTitle className="text-xl">Configure campaign</DialogTitle>
        </DialogHeader>

        <div className="max-h-[68vh] space-y-6 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Campaign name <span className="text-destructive">*</span>
            </Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 Plastics Outreach"
            />
          </div>

          <div className="rounded-2xl border border-border bg-card/60 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-start gap-2">
                <div>
                  <p className="text-sm font-medium leading-none">Human in the loop</p>
                  <p className="text-xs text-muted-foreground mt-1">Certify each draft before it can be sent to Instantly.</p>
                </div>
                <InfoTip text={CAMPAIGN_ACTION_HELP.humanInLoop} className="mt-0.5" />
              </div>
              <Switch checked={humanInLoop} onCheckedChange={setHumanInLoop} />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card/60 shadow-sm overflow-hidden divide-y divide-border">
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <Gauge className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium leading-none">Daily send limit</p>
                  <p className="text-xs text-muted-foreground">Max emails sent per day</p>
                </div>
              </div>
              <div className="flex items-center overflow-hidden rounded-md border border-input bg-background">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => updateDailyLimit(dailyLimit - 1)}
                  disabled={dailyLimit <= 1}
                  className="h-10 w-10 rounded-none border-r border-input"
                  aria-label="Decrease daily send limit"
                >
                  <Minus className="size-4" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={dailyLimit}
                  onChange={(e) => updateDailyLimit(Number(e.target.value) || 1)}
                  className="h-10 w-20 border-0 text-center shadow-none focus-visible:ring-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => updateDailyLimit(dailyLimit + 1)}
                  disabled={dailyLimit >= 500}
                  className="h-10 w-10 rounded-none border-l border-input"
                  aria-label="Increase daily send limit"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>

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

            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <Globe className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium leading-none">Timezone</p>
                  <p className="text-xs text-muted-foreground">Campaign sending timezone</p>
                </div>
              </div>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="h-9 w-45 bg-transparent">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent align="end" className="min-w-45">
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
          </div>

          <p className="text-xs text-muted-foreground">
            Drafts will be generated in the background. Review and certify them from the campaign view.
          </p>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="border-t border-border bg-card/30 px-6 py-4 flex justify-end">
          <Button
            disabled={!name.trim() || creating || leads.length === 0}
            onClick={handleCreate}
            className="gap-1.5"
          >
            {creating ? (
              <><Loader2 className="size-3.5 animate-spin" /> Creating…</>
            ) : (
              <>Create campaign <ChevronRight className="size-3.5" /></>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
