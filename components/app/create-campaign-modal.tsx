"use client";

import { useState } from "react";
import { ChevronRight, Loader2, Clock, Calendar, Gauge, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
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
      <DialogContent className="max-w-2xl p-0 gap-0 rounded-xl overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <p className="text-xs text-muted-foreground mb-0.5">
            New Campaign · {leads.length} lead{leads.length !== 1 ? "s" : ""} ready for outreach
          </p>
          <DialogTitle className="text-lg">Configure campaign</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[65vh]">
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

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="flex items-start gap-1.5">
                <div>
                  <p className="text-sm font-medium">Human in the loop</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Certify each draft before it can be sent to Instantly.</p>
                </div>
                <InfoTip text={CAMPAIGN_ACTION_HELP.humanInLoop} className="mt-0.5" />
              </div>
              <button type="button" onClick={() => setHumanInLoop(!humanInLoop)}
                className={cn(
                  "relative w-11 h-6 rounded-full border-2 transition-all shrink-0",
                  humanInLoop ? "bg-primary border-primary" : "bg-secondary border-border",
                )}
              >
                <span className={cn(
                  "absolute top-0.5 size-4 rounded-full transition-all",
                  humanInLoop ? "left-5 bg-primary-foreground" : "left-0.5 bg-muted-foreground",
                )} />
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <Gauge className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Daily send limit</p>
                  <p className="text-xs text-muted-foreground">Max emails sent per day</p>
                </div>
              </div>
              <Input
                type="number" min={1} max={500}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(Math.max(1, Math.min(500, Number(e.target.value))))}
                className="w-20 text-right"
              />
            </div>

            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <Clock className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Sending window</p>
                  <p className="text-xs text-muted-foreground">Local time of recipient</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input type="time" value={windowFrom} onChange={(e) => setWindowFrom(e.target.value)} className="w-28" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="time" value={windowTo} onChange={(e) => setWindowTo(e.target.value)} className="w-28" />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <Globe className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Timezone</p>
                  <p className="text-xs text-muted-foreground">Campaign sending timezone</p>
                </div>
              </div>
              <select
                value={timezone}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTimezone(e.target.value)}
                className="text-sm rounded-md border border-border bg-background px-2 py-1.5"
              >
                {TIMEZONES.map((tz) => <option key={tz} value={tz} className="bg-background">{tz}</option>)}
              </select>
            </div>

            <div className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <Calendar className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Send days</p>
                  <p className="text-xs text-muted-foreground">Days emails will be sent</p>
                </div>
              </div>
              <div className="flex gap-1">
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

        <div className="border-t border-border px-6 py-4 flex justify-end">
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
