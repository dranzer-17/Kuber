"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft, ChevronRight, RotateCcw, Send, Loader2,
  Users, Clock, Calendar, Gauge, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar } from "@/components/leads/lead-ui";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/leads";
import { createCampaign, addLeadsToCampaign, generateEmails, sendCampaign } from "@/lib/api-client";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function Toggle({ value, onChange, label, desc }: {
  value: boolean; onChange: (v: boolean) => void; label: string; desc: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5 border-b border-border last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <button type="button" onClick={() => onChange(!value)}
        className={cn(
          "relative w-11 h-6 rounded-full border-2 transition-all shrink-0",
          value ? "bg-primary border-primary" : "bg-secondary border-border",
        )}
      >
        <span className={cn(
          "absolute top-0.5 size-4 rounded-full transition-all",
          value ? "left-5 bg-primary-foreground" : "left-0.5 bg-muted-foreground",
        )} />
      </button>
    </div>
  );
}

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

// ── Draft email type ──────────────────────────────────────────────────────────

type DraftEmail = {
  lead_id: string;
  subject: string;
  body: string;
  loading: boolean;
};

// ── Main component ────────────────────────────────────────────────────────────

export function CreateCampaignModal({
  open, onClose, onCreated, leads,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Campaign) => void;
  leads: Lead[];
}) {
  // ── Step 1 state ─────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1);
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

  // ── Step 2 state ─────────────────────────────────────────────────────────
  const [drafts, setDrafts] = useState<DraftEmail[]>([]);
  const [cursor, setCursor] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [regenQuery, setRegenQuery] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // ── Campaign DB id (created before step 2) ────────────────────────────────
  const [campaignId, setCampaignId] = useState<string | null>(null);

  function reset() {
    setStep(1); setName(""); setHumanInLoop(true); setDailyLimit(30);
    setWindowFrom("08:00"); setWindowTo("18:00"); setTimezone("Asia/Kolkata");
    setSendDays({ monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false });
    setDrafts([]); setCursor(0); setGenerating(false); setRegenQuery("");
    setRegenOpen(false); setSending(false); setError(""); setCampaignId(null);
  }

  function handleClose() { reset(); onClose(); }

  // ── Advance to step 2: create campaign in DB, generate emails ─────────────
  async function handleContinue() {
    setError("");
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";

      // 1. Create campaign in DB
      const dbCampaign = await createCampaign(token, {
        name,
        human_in_loop: humanInLoop,
        daily_limit: dailyLimit,
        window_from: windowFrom,
        window_to: windowTo,
        schedule_timezone: timezone,
        send_days: sendDays,
      });
      setCampaignId(dbCampaign.id);

      // 2. Add leads to campaign
      await addLeadsToCampaign(token, dbCampaign.id, leads.map((l) => l.id));

      // 3. Seed draft placeholders so UI shows immediately
      const placeholders: DraftEmail[] = leads.map((l) => ({
        lead_id: l.id,
        subject: "",
        body: "",
        loading: true,
      }));
      setDrafts(placeholders);
      setStep(2);

      // 4. Generate all emails
      const { emails } = await generateEmails(token, {
        lead_ids: leads.map((l) => l.id),
        campaign_name: name,
      });

      setDrafts((prev) =>
        prev.map((d) => {
          const match = emails.find((e) => e.lead_id === d.lead_id);
          return match ? { ...d, subject: match.subject, body: match.body, loading: false } : { ...d, loading: false };
        })
      );
    } catch (e) {
      setError((e as Error).message);
      setStep(1);
    } finally {
      setGenerating(false);
    }
  }

  // ── Regenerate single lead ────────────────────────────────────────────────
  async function handleRegen() {
    const draft = drafts[cursor];
    if (!draft) return;
    setDrafts((prev) => prev.map((d, i) => i === cursor ? { ...d, loading: true } : d));
    setRegenOpen(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const { emails } = await generateEmails(token, {
        lead_ids: leads.map((l) => l.id),
        campaign_name: name,
        custom_instruction: regenQuery || undefined,
        single_lead_id: draft.lead_id,
      });
      const match = emails[0];
      if (match) {
        setDrafts((prev) => prev.map((d, i) =>
          i === cursor ? { ...d, subject: match.subject, body: match.body, loading: false } : d
        ));
      }
    } catch {
      setDrafts((prev) => prev.map((d, i) => i === cursor ? { ...d, loading: false } : d));
    }
    setRegenQuery("");
  }

  // ── Send all ──────────────────────────────────────────────────────────────
  async function handleSendAll() {
    if (!campaignId) return;
    setSending(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";

      const emailPayload = drafts
        .filter((d) => !d.loading && d.subject && d.body)
        .map((d) => {
          const lead = leads.find((l) => l.id === d.lead_id)!;
          return {
            lead_id: d.lead_id,
            email: lead.email,
            first_name: lead.firstName,
            last_name: lead.lastName,
            subject: d.subject,
            body: d.body,
          };
        });

      await sendCampaign(token, campaignId, {
        emails: emailPayload,
        config: { daily_limit: dailyLimit, window_from: windowFrom, window_to: windowTo, timezone, send_days: sendDays },
      });

      onCreated({
        id: campaignId,
        name,
        status: humanInLoop ? "Draft" : "Live",
        leads: leads.length,
        sent: 0,
        replied: 0,
        humanInLoop,
        createdAt: new Date().toISOString().slice(0, 10),
      });
      handleClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const currentDraft = drafts[cursor];
  const currentLead = leads[cursor];
  const allLoaded = drafts.length > 0 && drafts.every((d) => !d.loading);

  // Reset cursor when leads change
  useEffect(() => { setCursor(0); }, [leads]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0 rounded-xl overflow-hidden">

        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <p className="text-xs text-muted-foreground mb-0.5">
            New Campaign · Step {step} of 2 · {leads.length} lead{leads.length !== 1 ? "s" : ""}
          </p>
          <DialogTitle className="text-lg">
            {step === 1 ? "Configure campaign" : "Review emails"}
          </DialogTitle>
        </DialogHeader>

        {/* ── Progress bar ── */}
        <div className="flex gap-1 px-6 pt-4">
          {[1, 2].map((n) => (
            <div key={n} className={cn(
              "h-1 flex-1 rounded-full transition-all duration-300",
              n <= step ? "bg-primary" : "bg-secondary",
            )} />
          ))}
        </div>

        {/* ── Step 1: Config ── */}
        {step === 1 && (
          <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[65vh]">

            {/* Campaign name */}
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

            {/* Toggles */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <Toggle
                label="Human in the loop"
                desc="Emails saved as draft in Instantly — you approve before sending."
                value={humanInLoop}
                onChange={setHumanInLoop}
              />
            </div>

            {/* Sending config */}
            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">

              {/* Daily limit */}
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

              {/* Sending window */}
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

              {/* Timezone */}
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

              {/* Send days */}
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

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {/* ── Step 2: Email review carousel ── */}
        {step === 2 && (
          <div className="px-6 py-5 space-y-4 overflow-y-auto max-h-[65vh]">

            {/* Lead nav */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {currentLead && (
                  <>
                    <Avatar name={`${currentLead.firstName} ${currentLead.lastName}`} size="sm" />
                    <div>
                      <p className="text-sm font-semibold">{currentLead.firstName} {currentLead.lastName}</p>
                      <p className="text-xs text-muted-foreground">{currentLead.company} · {currentLead.jobTitle || currentLead.email}</p>
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCursor((c) => Math.max(0, c - 1))}
                  disabled={cursor === 0}
                  className="size-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="text-xs font-medium tabular-nums text-muted-foreground min-w-[50px] text-center">
                  {cursor + 1} of {leads.length}
                </span>
                <button
                  type="button"
                  onClick={() => setCursor((c) => Math.min(leads.length - 1, c + 1))}
                  disabled={cursor === leads.length - 1}
                  className="size-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>

            {/* Email editor */}
            {currentDraft?.loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="size-6 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground">Generating personalised email…</p>
              </div>
            ) : currentDraft ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Subject</Label>
                  <Input
                    value={currentDraft.subject}
                    onChange={(e) => setDrafts((prev) => prev.map((d, i) =>
                      i === cursor ? { ...d, subject: e.target.value } : d
                    ))}
                    placeholder="Email subject…"
                    className="font-medium"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Body</Label>
                  <Textarea
                    value={currentDraft.body}
                    onChange={(e) => setDrafts((prev) => prev.map((d, i) =>
                      i === cursor ? { ...d, body: e.target.value } : d
                    ))}
                    placeholder="Email body…"
                    rows={10}
                    className="text-sm leading-relaxed resize-none"
                  />
                </div>
              </div>
            ) : null}

            {/* Regenerate */}
            {!currentDraft?.loading && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setRegenOpen((o) => !o)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw className="size-3.5" />
                  Regenerate with instruction
                </button>
                {regenOpen && (
                  <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
                    <Input
                      autoFocus
                      value={regenQuery}
                      onChange={(e) => setRegenQuery(e.target.value)}
                      placeholder="e.g. Make it shorter and focus on cost savings…"
                      onKeyDown={(e) => e.key === "Enter" && handleRegen()}
                    />
                    <Button size="sm" onClick={handleRegen} className="gap-1.5">
                      <RotateCcw className="size-3.5" /> Regenerate
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Lead counter summary */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3.5" />
              <span>{drafts.filter((d) => !d.loading && d.subject).length} of {leads.length} emails ready</span>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="border-t border-border px-6 py-4 flex justify-between items-center">
          {step === 2 ? (
            <Button variant="outline" onClick={() => setStep(1)} disabled={sending}>
              <ChevronLeft className="size-3.5" /> Back
            </Button>
          ) : (
            <div />
          )}

          {step === 1 ? (
            <Button
              disabled={!name.trim() || generating}
              onClick={handleContinue}
              className="gap-1.5"
            >
              {generating ? (
                <><Loader2 className="size-3.5 animate-spin" /> Generating…</>
              ) : (
                <>Continue <ChevronRight className="size-3.5" /></>
              )}
            </Button>
          ) : (
            <Button
              disabled={!allLoaded || sending}
              onClick={handleSendAll}
              className="gap-1.5"
            >
              {sending ? (
                <><Loader2 className="size-3.5 animate-spin" /> Sending…</>
              ) : (
                <><Send className="size-3.5" /> {humanInLoop ? "Save to Instantly" : "Send all"} · {leads.length} emails</>
              )}
            </Button>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
