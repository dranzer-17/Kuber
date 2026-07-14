"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, Clock, Calendar as CalendarIcon, Globe, Calendar, Paperclip, Upload, FileText, X, Check } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { InfoTip } from "@/components/ui/info-tip";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/leads";
import { isCampaignEligible, CAMPAIGN_ACTION_HELP, getMostCommonCountry } from "@/lib/leads";
import { COUNTRY_TO_TIMEZONE } from "@/lib/constants";
import { createCampaign, addLeadsToCampaign, triggerDraftGeneration, mapDbCampaign, fetchMySettings, uploadCampaignAttachment } from "@/lib/api-client";
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
  dailyLimit?: number;
  windowFrom?: string;
  windowTo?: string;
  timezone?: string;
  sendDays?: Record<string, boolean>;
  aiPromptContext?: string;
  senderName?: string;
  attachmentName?: string;
  hot?: number;
  cold?: number;
  followupDays?: number[];
  createdBy?: string;
  assignedTo?: string | null;
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
export const DAY_LABELS: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Bangkok",
  "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles",
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
      <SelectTrigger className="h-9 w-32 tabular-nums">
        <SelectValue placeholder="Select time" />
      </SelectTrigger>
      <SelectContent align="center" className="min-w-32 max-h-56">
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
  const [dailyLimit] = useState(30);
  const [windowFrom, setWindowFrom] = useState("08:00");
  const [windowTo, setWindowTo] = useState("18:00");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [timezoneOverride, setTimezoneOverride] = useState(false);
  const [primaryCountry, setPrimaryCountry] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>();
  const [senderName, setSenderName] = useState("");
  const [aiPromptContext, setAiPromptContext] = useState("");
  const [sendDays, setSendDays] = useState<Record<string, boolean>>({
    monday: true, tuesday: true, wednesday: true, thursday: true,
    friday: true, saturday: false, sunday: false,
  });
  const [followupSteps, setFollowupSteps] = useState<{ delay: number; delay_unit: "minutes" | "hours" | "days" }[]>([
    { delay: 30, delay_unit: "days" },
    { delay: 90, delay_unit: "days" },
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const [attachment, setAttachment] = useState<{
    attachment_path: string;
    attachment_name: string;
    attachment_mime: string;
    attachment_size: number;
    attachment_url: string | null;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File exceeds 10MB"); return;
    }
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const result = await uploadCampaignAttachment(token, file);
      setAttachment(result);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment() {
    setAttachment(null);
    setUploadError("");
  }

  useEffect(() => {
    if (!open) return;
    const country = getMostCommonCountry(leads);
    const autoTz = country ? (COUNTRY_TO_TIMEZONE[country] ?? "UTC") : "Asia/Kolkata";
    setPrimaryCountry(country);
    setTimezone(autoTz);
    setTimezoneOverride(false);

    async function loadSettings() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        // Default "From" name: the creator's personal sender name, else the company default.
        const s = await fetchMySettings(token);
        setSenderName(s.sender_name ?? s.defaults.sender_name ?? "");
      } catch { /* use empty default */ }
    }
    void loadSettings();
  }, [open, leads]);

  function reset() {
    setName(""); setHumanInLoop(true);
    setWindowFrom("08:00"); setWindowTo("18:00"); setTimezone("Asia/Kolkata");
    setTimezoneOverride(false); setPrimaryCountry(null);
    setScheduleDate(undefined); setSenderName(""); setAiPromptContext("");
    setSendDays({ monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false });
    setFollowupSteps([{ delay: 30, delay_unit: "days" }, { delay: 90, delay_unit: "days" }]);
    setCreating(false); setError("");
    setAttachment(null); setUploading(false); setUploadError("");
  }

  function handleClose() { reset(); onClose(); }

  async function handleCreate() {
    setError("");
    const eligibleLeads = leads.filter(isCampaignEligible);
    if (eligibleLeads.length === 0) {
      setError("None of the selected leads are ready for a campaign. Add leads that are Enriched, or Input Required (they'll use the generic template). New leads are still being enriched — wait for them to finish.");
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
        ai_prompt_context: aiPromptContext || undefined,
        sender_name: senderName || undefined,
        followup_steps: followupSteps,
        ...(scheduleDate ? {
          send_mode: "scheduled" as const,
          schedule_start_at: new Date(
            scheduleDate.getFullYear(),
            scheduleDate.getMonth(),
            scheduleDate.getDate(),
            9, 0, 0,
          ).toISOString(),
        } : { send_mode: "now" as const }),
        ...(attachment ? {
          attachment_path: attachment.attachment_path,
          attachment_name: attachment.attachment_name,
          attachment_mime: attachment.attachment_mime,
          attachment_size: attachment.attachment_size,
          attachment_url: attachment.attachment_url,
        } : {}),
      });

      await addLeadsToCampaign(token, dbCampaign.id, eligibleLeads.map((l) => l.id));
      // fire-and-forget — drafts generate in background, don't block the redirect
      void triggerDraftGeneration(token, dbCampaign.id);

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
      <DialogContent className="max-w-3xl overflow-hidden p-0">
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
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 Plastics Outreach" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Sender name</Label>
            <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Kuber Polyplast" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Additional context for AI</Label>
            <Textarea
              value={aiPromptContext}
              onChange={(e) => setAiPromptContext(e.target.value)}
              placeholder="e.g. Mention our new biodegradable masterbatch line. Focus on sustainability angle. Avoid mentioning pricing."
              rows={3}
            />
          </div>

          <div className="rounded-lg border border-border bg-secondary/30 shadow-sm overflow-hidden">
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

          <div className="rounded-lg border border-border bg-secondary/30 shadow-sm overflow-hidden divide-y divide-border">
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

            <div className="flex flex-col gap-2 px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <Globe className="size-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium leading-none">Timezone</p>
                    <p className="text-xs text-muted-foreground">
                      Auto-detected: {timezone}{primaryCountry ? ` (${primaryCountry})` : ""}
                    </p>
                  </div>
                </div>
                {!timezoneOverride ? (
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setTimezoneOverride(true)}>
                    Override
                  </button>
                ) : (
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger className="h-9 w-45">
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent align="end" className="min-w-45">
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <Calendar className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium leading-none">Send date</p>
                  <p className="text-xs text-muted-foreground">Optional — leave empty to send when ready</p>
                </div>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <CalendarIcon className="size-3.5" />
                    {scheduleDate ? format(scheduleDate, "PPP") : "Pick send date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarPicker mode="single" selected={scheduleDate} onSelect={setScheduleDate} />
                </PopoverContent>
              </Popover>
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

            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <Clock className="size-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium leading-none">Follow-up schedule</p>
                  <p className="text-xs text-muted-foreground">Wait time after the previous email before each follow-up sends</p>
                </div>
              </div>
              <div className="space-y-2">
                {followupSteps.map((step, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2">
                    <span className="text-xs text-muted-foreground shrink-0 w-24">Follow-up {idx + 1} after</span>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={step.delay}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                        setFollowupSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, delay: v } : s)));
                      }}
                      className="h-7 w-16 text-center border-0 bg-transparent p-0 text-sm font-medium focus-visible:ring-0"
                    />
                    <Select
                      value={step.delay_unit}
                      onValueChange={(unit) =>
                        setFollowupSteps((prev) =>
                          prev.map((s, i) => (i === idx ? { ...s, delay_unit: unit as "minutes" | "hours" | "days" } : s)),
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
            </div>
          </div>

          <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Paperclip className="size-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium text-sm">Attachment (optional)</p>
                <p className="text-xs text-muted-foreground">
                  Sent with every email in this campaign. PDF, DOC, XLS, PNG, JPG — max 10MB.
                </p>
              </div>
            </div>

            {!attachment ? (
              <>
                <input
                  ref={fileInputRef} type="file" className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                  onChange={handleFileSelect}
                />
                <Button
                  type="button" variant="outline" size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {uploading ? "Uploading…" : "Choose file"}
                </Button>
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="size-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{attachment.attachment_name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      ({attachment.attachment_size >= 1024 * 1024
        ? (attachment.attachment_size / 1024 / 1024).toFixed(1) + " MB"
        : Math.round(attachment.attachment_size / 1024) + " KB"})
                    </span>
                  </div>
                  <button type="button" onClick={removeAttachment}
                          className="text-muted-foreground hover:text-foreground">
                    <X className="size-4" />
                  </button>
                </div>
                <p className="text-xs text-green-500 flex items-center gap-1">
                  <Check className="size-3" /> The AI will mention the attachment in each email.
                </p>
              </div>
            )}

            {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
          </div>

          <p className="text-xs text-muted-foreground">
            Drafts will be generated in the background. Review and certify them from the campaign view.
          </p>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="border-t border-border bg-card/30 px-6 py-4 flex justify-end">
          <Button disabled={!name.trim() || creating || uploading || leads.length === 0} onClick={handleCreate} className="gap-1.5">
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
