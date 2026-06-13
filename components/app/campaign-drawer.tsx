"use client";

import { useEffect, useState } from "react";
import {
  X, Megaphone, Users, Send, MessageSquare, Clock, Gauge,
  Globe, Calendar, ExternalLink, Loader2, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/leads/lead-ui";
import { fetchCampaignLeads } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import type { Campaign } from "@/components/app/create-campaign-modal";

const STATUS_STYLES: Record<string, string> = {
  Draft:     "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
  Live:      "bg-green-500/15 text-green-400 border-green-500/25",
  Paused:    "bg-amber-500/15 text-amber-400 border-amber-500/25",
  Scheduled: "bg-blue-500/15 text-blue-400 border-blue-500/25",
};

const CRM_STYLES: Record<string, string> = {
  new:        "bg-zinc-500/10 text-zinc-400",
  sent:       "bg-teal-500/10 text-teal-400",
  replied:    "bg-green-500/10 text-green-400",
  bounced:    "bg-red-500/10 text-red-400",
  unsubscribed: "bg-orange-500/10 text-orange-400",
};

type CampaignLead = {
  id: string;
  crm_status: string;
  created_at: string;
  leads: { first_name: string | null; last_name: string | null; email: string | null; title: string | null; country: string | null } | null;
  email_drafts: { subject: string | null; status: string } | null;
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">{label}</p>
      {children}
    </div>
  );
}

const DAY_SHORT: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

export function CampaignDrawer({
  campaign,
  onClose,
  onLeadClick,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onLeadClick?: (leadId: string) => void;
}) {
  const [campaignLeads, setCampaignLeads] = useState<CampaignLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!campaign) { setCampaignLeads([]); return; }
    setLoading(true);
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return;
      fetchCampaignLeads(session.access_token, campaign.id)
        .then((res) => setCampaignLeads(res.campaign_leads as CampaignLead[]))
        .catch(() => {})
        .finally(() => setLoading(false));
    });
  }, [campaign?.id]);

  if (!campaign) return null;

  const activeDays = Object.entries(campaign.sendDays ?? {})
    .filter(([, v]) => v)
    .map(([k]) => DAY_SHORT[k] ?? k);

  return (
    <div className="fixed inset-0 z-40 flex justify-end pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 pointer-events-auto"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="relative w-[480px] h-full bg-card border-l border-border shadow-2xl flex flex-col pointer-events-auto overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 rounded-xl bg-secondary border border-border flex items-center justify-center shrink-0">
              <Megaphone className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-base truncate">{campaign.name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide border rounded px-1.5 py-0.5",
                  STATUS_STYLES[campaign.status] ?? STATUS_STYLES.Draft,
                )}>{campaign.status}</span>
                {campaign.humanInLoop && (
                  <span className="text-[10px] text-muted-foreground">Human review ON</span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Users,         label: "Leads",   value: campaign.leads   },
              { icon: Send,          label: "Sent",    value: campaign.sent    },
              { icon: MessageSquare, label: "Replied", value: campaign.replied },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-xl border border-border bg-secondary/30 p-3 text-center">
                <Icon className="size-3.5 text-muted-foreground mx-auto mb-1" />
                <p className="text-xl font-bold tabular-nums">{value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              </div>
            ))}
          </div>

          {/* Config */}
          <Section label="Configuration">
            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Gauge className="size-3.5" /> Daily limit
                </div>
                <span className="text-sm font-medium">{campaign.dailyLimit ?? 30} emails/day</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="size-3.5" /> Sending window
                </div>
                <span className="text-sm font-medium">{campaign.windowFrom ?? "08:00"} – {campaign.windowTo ?? "18:00"}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Globe className="size-3.5" /> Timezone
                </div>
                <span className="text-sm font-medium">{campaign.timezone ?? "—"}</span>
              </div>
              {activeDays.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="size-3.5" /> Send days
                  </div>
                  <span className="text-sm font-medium">{activeDays.join(", ")}</span>
                </div>
              )}
            </div>
          </Section>

          {/* Instantly link */}
          {campaign.instantlyId && (
            <Section label="Instantly">
              <a
                href={`https://app.instantly.ai/app/campaign/${campaign.instantlyId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" />
                View in Instantly
              </a>
            </Section>
          )}

          {/* Leads list */}
          <Section label={`Leads (${campaign.leads})`}>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-4 text-muted-foreground animate-spin" />
              </div>
            ) : campaignLeads.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No leads in this campaign yet.</p>
            ) : (
              <div className="space-y-1.5">
                {campaignLeads.map((cl) => {
                  const lead = cl.leads;
                  const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Unknown";
                  return (
                    <div
                      key={cl.id}
                      className="rounded-xl border border-border bg-card overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedDraft((prev) => prev === cl.id ? null : cl.id);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/40 transition-colors text-left"
                      >
                        <Avatar name={name} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{lead?.title || lead?.email}</p>
                        </div>
                        <span className={cn(
                          "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0",
                          CRM_STYLES[cl.crm_status] ?? "bg-secondary text-muted-foreground",
                        )}>
                          {cl.crm_status}
                        </span>
                        {cl.email_drafts?.status === "sent" && (
                          <CheckCircle2 className="size-3.5 text-green-400 shrink-0" />
                        )}
                      </button>

                      {expandedDraft === cl.id && cl.email_drafts?.subject && (
                        <div className="px-4 pb-3 pt-1 border-t border-border bg-secondary/20">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Subject</p>
                          <p className="text-xs font-medium mb-2">{cl.email_drafts.subject}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 shrink-0">
          <p className="text-[11px] text-muted-foreground">Created {campaign.createdAt}</p>
        </div>
      </div>
    </div>
  );
}
