"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Megaphone, Users, Send, MessageSquare, Clock, Gauge,
  Globe, Calendar, ExternalLink, Loader2, CheckCircle2, RotateCcw, Check, Save, History, ChevronDown, ChevronRight,
  List, LayoutGrid, BarChart2, Paperclip, FileText, Upload,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/leads/lead-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  fetchCampaignLeads,
  fetchDraftProgress,
  approveDraft,
  bulkApproveDrafts,
  editDraft,
  regenerateDraft,
  sendApprovedLeads,
  fetchDraftHistory,
  restoreDraftVersion,
  reopenDraft,
  fetchCampaignReport,
  retryFailedDrafts,
  uploadCampaignLeadAttachment,
  removeCampaignLeadAttachment,
} from "@/lib/api-client";
import { CampaignKanban } from "@/components/app/campaign-kanban";
import { CampaignReportView, type CampaignReportData } from "@/components/app/campaign-report";
import { LeadDrawer } from "@/components/app/lead-drawer";
import { OrgDrawer } from "@/components/app/org-drawer";
import { supabase } from "@/lib/supabase";
import type { Campaign } from "@/components/app/create-campaign-modal";
import { InfoTip } from "@/components/ui/info-tip";
import type { Lead } from "@/lib/leads";
import {
  DRAFT_BADGE_SHORT,
  CAMPAIGN_STATUS_HELP,
  CAMPAIGN_ACTION_HELP,
  type CampaignLeadsSort,
} from "@/lib/leads";

const STATUS_STYLES: Record<string, string> = {
  Draft:     "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
  Live:      "bg-green-500/15 text-green-400 border-green-500/25",
  Paused:    "bg-amber-500/15 text-amber-400 border-amber-500/25",
  Scheduled: "bg-blue-500/15 text-blue-400 border-blue-500/25",
};

const DRAFT_STATUS_LABEL: Record<string, string> = {
  generating: "Generating",
  draft:      "Draft",
  approved:   "Certified",
  sent:       "Sent",
  failed:     "Failed",
  rejected:   "Rejected",
};

const DRAFT_STATUS_STYLE: Record<string, string> = {
  generating: "bg-amber-500/10 text-amber-400",
  draft:      "bg-blue-500/10 text-blue-400",
  approved:   "bg-green-500/10 text-green-400",
  sent:       "bg-teal-500/10 text-teal-400",
  failed:     "bg-red-500/10 text-red-400",
  rejected:   "bg-zinc-500/10 text-zinc-400",
};

type AttachmentInfo = {
  perLead: { name: string; size: number; mime: string } | null;
  campaignDefault: { name: string; size: number; mime: string } | null;
  effective: { name: string; size: number; url: string | null; source: "lead" | "campaign" } | null;
};

type CampaignLead = {
  id: string;
  lead_id: string;
  crm_status: string;
  created_at: string;
  leads: { first_name: string | null; last_name: string | null; email: string | null; title: string | null; country: string | null } | null;
  email_drafts: { id: string; subject: string | null; body: string | null; status: string } | null;
  attachment?: AttachmentInfo;
};

type DraftProgress = {
  total: number; generating: number; draft: number; approved: number;
  sent: number; failed: number; pending: number;
};

const DAY_SHORT: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

function sortCampaignLeads(leads: CampaignLead[], sort: CampaignLeadsSort): CampaignLead[] {
  const copy = [...leads];
  if (sort === "newest") {
    return copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return copy.sort((a, b) => {
    const aName = [a.leads?.first_name, a.leads?.last_name].filter(Boolean).join(" ");
    const bName = [b.leads?.first_name, b.leads?.last_name].filter(Boolean).join(" ");
    return aName.localeCompare(bName);
  });
}

function getSidebarBadge(cl: CampaignLead, isGenerating: boolean): string {
  const ds = cl.email_drafts?.status;
  if (ds && DRAFT_BADGE_SHORT[ds]) return DRAFT_BADGE_SHORT[ds];
  if (cl.crm_status === "new" || cl.crm_status === "enriched") {
    return isGenerating ? "Pending" : "Pending";
  }
  return "—";
}

type CampaignViewTab = "list" | "kanban" | "report";

function DraftStatusBadge({
  label,
  styleClass,
  helpText,
}: {
  label: string;
  styleClass: string;
  helpText?: string;
}) {
  return (
    <span
      className={cn(
        "text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0",
        "inline-flex items-center justify-center gap-1",
        styleClass,
      )}
    >
      {label}
      {helpText && <InfoTip text={helpText} />}
    </span>
  );
}

export function CampaignDetail({
  campaign,
  onBack,
}: {
  campaign: Campaign;
  onBack: () => void;
}) {
  const [campaignLeads, setCampaignLeads] = useState<CampaignLead[]>([]);
  const [progress, setProgress] = useState<DraftProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenQuery, setRegenQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [certifying, setCertifying] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [leadsSort, setLeadsSort] = useState<CampaignLeadsSort>("az");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: string; subject: string | null; body: string | null; status: string; version: number; created_at: string }>>([]);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [viewTab, setViewTab] = useState<CampaignViewTab>("list");
  const [report, setReport] = useState<CampaignReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const leadFileRef = useRef<HTMLInputElement>(null);
  const [uploadingLeadAtt, setUploadingLeadAtt] = useState(false);
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const [drawerOrgId, setDrawerOrgId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const token = session.access_token;
    const [leadsRes, prog] = await Promise.all([
      fetchCampaignLeads(token, campaign.id),
      fetchDraftProgress(token, campaign.id),
    ]);
    const leads = leadsRes.campaign_leads as CampaignLead[];
    setCampaignLeads(leads);
    setProgress(prog);
    return leads;
  }, [campaign.id]);

  useEffect(() => {
    setLoading(true);
    loadData()
      .then((leads) => {
        if (leads && leads.length === 1) {
          setSelectedId(leads[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loadData]);

  useEffect(() => {
    if (viewTab !== "report") return;
    let cancelled = false;
    setReportLoading(true);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      try {
        const data = await fetchCampaignReport(session.access_token, campaign.id);
        if (!cancelled) setReport(data);
      } catch {
        if (!cancelled) setReport(null);
      } finally {
        if (!cancelled) setReportLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [viewTab, campaign.id, campaignLeads.length, progress?.sent, progress?.failed]);

  useEffect(() => {
    if (!progress) return;
    const isGenerating = (progress.generating + progress.pending) > 0;
    if (!isGenerating) return;
    const interval = setInterval(() => { void loadData(); }, 3000);
    return () => clearInterval(interval);
  }, [progress, loadData]);

  const selected = campaignLeads.find((cl) => cl.id === selectedId) ?? null;

  useEffect(() => {
    if (selected?.email_drafts) {
      setEditSubject(selected.email_drafts.subject ?? "");
      setEditBody(selected.email_drafts.body ?? "");
    } else {
      setEditSubject("");
      setEditBody("");
    }
    setRegenOpen(false);
    setRegenQuery("");
    setHistoryOpen(false);
    setPreviewVersionId(null);
    setError("");
  }, [selected?.id, selected?.email_drafts?.subject, selected?.email_drafts?.body]);

  useEffect(() => {
    if (!selected?.email_drafts?.id) { setVersions([]); return; }
    async function loadHistory() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { versions: v } = await fetchDraftHistory(session.access_token, selected!.email_drafts!.id);
        setVersions(v);
      } catch { setVersions([]); }
    }
    void loadHistory();
  }, [selected?.email_drafts?.id]);

  const activeDays = Object.entries(campaign.sendDays ?? {})
    .filter(([, v]) => v)
    .map(([k]) => DAY_SHORT[k] ?? k);

  const draftReadyLeads = campaignLeads.filter((cl) => cl.email_drafts?.status === "draft");
  const certifiedCount = campaignLeads.filter((cl) =>
    cl.email_drafts?.status === "approved" || cl.crm_status === "approved"
  ).length;
  const isGenerating = progress ? (progress.generating + progress.pending) > 0 : false;
  const progressPct = progress && progress.total > 0
    ? Math.round(((progress.draft + progress.approved + progress.sent + progress.failed) / progress.total) * 100)
    : 0;
  const progressCompleted = progress
    ? progress.draft + progress.approved + progress.sent + progress.failed
    : 0;

  function getDisplayStatus(cl: CampaignLead): string {
    if (cl.email_drafts?.status) return DRAFT_STATUS_LABEL[cl.email_drafts.status] ?? cl.crm_status;
    if (cl.crm_status === "new" || cl.crm_status === "enriched") return isGenerating ? "Pending" : "No draft";
    return cl.crm_status;
  }

  function getStatusStyle(cl: CampaignLead): string {
    const ds = cl.email_drafts?.status;
    if (ds && DRAFT_STATUS_STYLE[ds]) return DRAFT_STATUS_STYLE[ds];
    return "bg-secondary text-muted-foreground";
  }

  function toggleCheck(clId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(clId)) next.delete(clId); else next.add(clId);
      return next;
    });
  }

  function toggleAllDraftReady() {
    const ids = draftReadyLeads.map((cl) => cl.id);
    const allChecked = ids.every((id) => checkedIds.has(id));
    setCheckedIds(allChecked ? new Set() : new Set(ids));
  }

  async function handleSaveEdit() {
    if (!selected?.email_drafts?.id) return;
    setSaving(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await editDraft(session.access_token, selected.email_drafts.id, editSubject, editBody);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReopen() {
    if (!selected?.email_drafts?.id) return;
    setCertifying(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await reopenDraft(session.access_token, selected.email_drafts.id);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCertifying(false);
    }
  }

  async function handleRestoreVersion(versionId: string) {
    setRestoring(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await restoreDraftVersion(session.access_token, versionId);
      setPreviewVersionId(null);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  function loadVersionPreview(v: { id: string; subject: string | null; body: string | null }) {
    setPreviewVersionId(v.id);
    setEditSubject(v.subject ?? "");
    setEditBody(v.body ?? "");
  }

  const isPreviewingHistory = previewVersionId !== null && previewVersionId !== selected?.email_drafts?.id;

  async function handleCertifyOne(draftId: string) {
    setCertifying(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await approveDraft(session.access_token, draftId);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCertifying(false);
    }
  }

  async function handleBulkCertify(draftIds?: string[]) {
    const ids = draftIds ?? campaignLeads
      .filter((cl) => cl.email_drafts?.status === "draft")
      .map((cl) => cl.email_drafts!.id);
    if (ids.length === 0) return;
    setCertifying(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await bulkApproveDrafts(session.access_token, ids);
      setCheckedIds(new Set());
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCertifying(false);
    }
  }

  async function handleCertifyAll() {
    await handleBulkCertify();
  }

  async function handleRegenerate() {
    if (!selected?.email_drafts?.id) return;
    setRegenerating(true);
    setRegenOpen(false);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { draft } = await regenerateDraft(session.access_token, selected.email_drafts.id, regenQuery || undefined);
      setEditSubject(draft.subject ?? "");
      setEditBody(draft.body ?? "");
      setRegenQuery("");
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const certifiedLeadIds = campaignLeads
        .filter((cl) => cl.crm_status === "approved" || cl.email_drafts?.status === "approved")
        .map((cl) => cl.lead_id);
      if (certifiedLeadIds.length === 0) {
        setError("No certified leads to send.");
        return;
      }
      await sendApprovedLeads(session.access_token, campaign.id, certifiedLeadIds);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function handleRetryOne(draftId: string, campaignLeadId: string) {
    setRetryingId(campaignLeadId);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await regenerateDraft(session.access_token, draftId);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetryingId(null);
    }
  }

  async function handleRetryAllFailed() {
    setRetryingAll(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { retried, errors } = await retryFailedDrafts(session.access_token, campaign.id);
      if (errors.length > 0 && retried === 0) {
        setError(errors[0] ?? "Retry failed");
      } else if (errors.length > 0) {
        setError(`Retried ${retried}; ${errors.length} still failed`);
      }
      await loadData();
      if (viewTab === "report") {
        const data = await fetchCampaignReport(session.access_token, campaign.id);
        setReport(data);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetryingAll(false);
    }
  }

  function handleKanbanSelect(campaignLeadId: string) {
    setSelectedId(campaignLeadId);
    setViewTab("list");
  }

  const checkedDraftCount = campaignLeads.filter(
    (cl) => checkedIds.has(cl.id) && cl.email_drafts?.status === "draft"
  ).length;

  const sortedCampaignLeads = sortCampaignLeads(campaignLeads, leadsSort);

  const selectedLead = selected?.leads;
  const selectedName = selectedLead
    ? [selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(" ") || "Unknown"
    : "";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-8 py-5 shrink-0 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft className="size-4" /> All campaigns
            </button>
            <div className="h-5 w-px bg-border shrink-0" />
            <div className="min-w-0">
              <h1 className="text-lg font-bold truncate">{campaign.name}</h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide border rounded px-1.5 py-0.5",
                  STATUS_STYLES[campaign.status] ?? STATUS_STYLES.Draft,
                )}>{campaign.status}</span>
                {campaign.humanInLoop && (
                  <span className="text-[10px] text-muted-foreground">Human review</span>
                )}
                {isGenerating && (
                  <span className="text-[10px] text-amber-400 flex items-center gap-1">
                    <Loader2 className="size-2.5 animate-spin" /> Generating…
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {draftReadyLeads.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={certifying}
                onClick={handleCertifyAll}
              >
                {certifying ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
                Certify all ({draftReadyLeads.length})
              </Button>
            )}
            <Button
              size="sm"
              disabled={sending || certifiedCount === 0}
              onClick={handleSend}
            >
              {sending ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
              {sending ? "Sending…" : `Send (${certifiedCount})`}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-4 text-sm">
            {[
              { label: "Leads", value: campaign.leads },
              { label: "Sent", value: campaign.sent },
              { label: "Replied", value: campaign.replied },
            ].map(({ label, value }) => (
              <span key={label} className="text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{value}</span> {label}
              </span>
            ))}
          </div>

          {progress && (
            <div className="flex flex-wrap gap-2 text-[10px] items-center">
              {progress.draft > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                  {progress.draft} draft ready
                  <InfoTip text={CAMPAIGN_STATUS_HELP.draft} />
                </span>
              )}
              {progress.approved > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">
                  {progress.approved} certified
                  <InfoTip text={CAMPAIGN_STATUS_HELP.approved} />
                </span>
              )}
              {progress.sent > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400">
                  {progress.sent} sent
                  <InfoTip text={CAMPAIGN_STATUS_HELP.sent} />
                </span>
              )}
              {progress.failed > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                  {progress.failed} failed
                  <InfoTip text={CAMPAIGN_STATUS_HELP.failed} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[10px] gap-1 text-red-400 hover:text-red-300"
                    disabled={retryingAll}
                    onClick={() => void handleRetryAllFailed()}
                  >
                    {retryingAll ? <Loader2 className="size-2.5 animate-spin" /> : <RotateCcw className="size-2.5" />}
                    Retry
                  </Button>
                </span>
              )}
            </div>
          )}

        </div>
      </div>

      {/* View tabs: List | Kanban | Report */}
      <div className="border-b border-border px-8 py-2 shrink-0 flex items-center justify-between">
        <div className="flex gap-1">
        {([
          { id: "list" as const, label: "Leads" },
          { id: "kanban" as const, label: "Kanban" },
          { id: "report" as const, label: "Report" },
        ]).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setViewTab(id)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              viewTab === id
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
            )}
          >
            {label}
          </button>
        ))}
        </div>

        <div className="flex items-center gap-4">
          {progress && progress.total > 0 && progressCompleted < progress.total && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="font-medium text-foreground">{progressCompleted} out of {progress.total}</span>
            </span>
          )}
          {progress && progress.total > 0 && progressCompleted >= progress.total && (
            <span className="flex items-center gap-1.5 text-sm text-green-500">
              <CheckCircle2 className="size-4" /> {progress.total} ready
            </span>
          )}

          {/* Config — floating overlay anchored to button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setConfigOpen((o) => !o)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {configOpen ? "Hide config" : "Show config"}
            </button>
            {configOpen && (
              <div className="absolute right-0 top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-xl divide-y divide-border overflow-hidden text-sm w-72">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground flex items-center gap-2"><Gauge className="size-3.5" /> Daily limit</span>
                  <span className="font-medium">{campaign.dailyLimit ?? 30}/day</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground flex items-center gap-2"><Clock className="size-3.5" /> Window</span>
                  <span className="font-medium">{campaign.windowFrom ?? "08:00"} – {campaign.windowTo ?? "18:00"}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground flex items-center gap-2"><Globe className="size-3.5" /> Timezone</span>
                  <span className="font-medium">{campaign.timezone ?? "—"}</span>
                </div>
                {activeDays.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-muted-foreground flex items-center gap-2"><Calendar className="size-3.5" /> Days</span>
                    <span className="font-medium">{activeDays.join(", ")}</span>
                  </div>
                )}
                {campaign.instantlyId && (
                  <div className="px-4 py-2.5">
                    <a
                      href={`https://app.instantly.ai/app/campaign/${campaign.instantlyId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="size-3.5" /> View in Instantly
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {viewTab === "report" ? (
        reportLoading ? (
          <div className="flex-1 p-6 space-y-4 animate-pulse">
            <div className="grid grid-cols-3 gap-4">
              {[0,1,2].map((i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="h-3 w-16 bg-secondary rounded" />
                  <div className="h-8 w-12 bg-secondary rounded" />
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="h-3 w-24 bg-secondary rounded" />
              <div className="h-4 bg-secondary/60 rounded-full" />
              {[80,60,40,90,30].map((w,i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-3 w-20 bg-secondary/60 rounded" />
                  <div className="h-3 bg-secondary rounded flex-1" style={{ width: `${w}%` }} />
                  <div className="h-3 w-8 bg-secondary/60 rounded" />
                </div>
              ))}
            </div>
          </div>
        ) : report ? (
          <CampaignReportView
            report={report}
            onRetryAllFailed={report.draftGeneration.failed > 0 ? handleRetryAllFailed : undefined}
            retrying={retryingAll}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Could not load report.
          </div>
        )
      ) : viewTab === "kanban" ? (
        <div className="flex flex-col flex-1 min-h-0 bg-card/30">
          <div className="px-4 py-3 border-b border-border shrink-0 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Campaign journey
            </p>
            {progress && progress.failed > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 border-red-500/30 text-red-400"
                disabled={retryingAll}
                onClick={() => void handleRetryAllFailed()}
              >
                {retryingAll ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                Retry failed ({progress.failed})
              </Button>
            )}
          </div>
          <CampaignKanban
            leads={sortedCampaignLeads}
            selectedId={selectedId}
            onSelect={handleKanbanSelect}
            onRetry={handleRetryOne}
            retryingId={retryingId}
          />
          {error && <p className="text-sm text-destructive px-4 pb-3">{error}</p>}
        </div>
      ) : (
      <div className="flex flex-1 min-h-0">
        <div className="w-80 shrink-0 border-r border-border flex flex-col bg-card/50">
          <div className="px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center justify-between mb-1 gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1">
                Leads ({campaign.leads})
                <InfoTip text="Select leads to certify individually, or use Certify all in the header." />
              </p>
              <div className="flex rounded-md border border-border p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setLeadsSort("az")}
                  className={cn("px-2 py-0.5 rounded", leadsSort === "az" ? "bg-secondary text-foreground" : "text-muted-foreground")}
                >
                  A–Z
                </button>
                <button
                  type="button"
                  onClick={() => setLeadsSort("newest")}
                  className={cn("px-2 py-0.5 rounded", leadsSort === "newest" ? "bg-secondary text-foreground" : "text-muted-foreground")}
                >
                  Newest
                </button>
              </div>
            </div>
            {draftReadyLeads.length > 0 && (
              <div className="flex items-center justify-between gap-2 mt-2">
                <button
                  type="button"
                  onClick={toggleAllDraftReady}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {draftReadyLeads.every((cl) => checkedIds.has(cl.id)) ? "Deselect all" : "Select all draft-ready"}
                </button>
                {checkedDraftCount > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1 px-2"
                    disabled={certifying}
                    onClick={() => handleBulkCertify(
                      campaignLeads
                        .filter((cl) => checkedIds.has(cl.id) && cl.email_drafts?.status === "draft")
                        .map((cl) => cl.email_drafts!.id),
                    )}
                  >
                    {certifying ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
                    Certify selected ({checkedDraftCount})
                    <InfoTip text={CAMPAIGN_ACTION_HELP.certifySelected} />
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading ? (
              <div className="space-y-1 animate-pulse">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-2.5 rounded-lg">
                    <div className="size-8 rounded-full bg-secondary shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-secondary rounded" style={{ width: `${45 + (i % 3) * 15}%` }} />
                      <div className="h-2.5 bg-secondary/60 rounded w-20" />
                    </div>
                    <div className="h-5 w-14 bg-secondary rounded-full shrink-0" />
                  </div>
                ))}
              </div>
            ) : sortedCampaignLeads.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center px-2">No leads yet.</p>
            ) : (
              sortedCampaignLeads.map((cl) => {
                const lead = cl.leads;
                const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Unknown";
                const isSelected = selectedId === cl.id;
                const canCheck = cl.email_drafts?.status === "draft";
                return (
                  <button
                    key={cl.id}
                    type="button"
                    onClick={() => setSelectedId(cl.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-2.5 rounded-lg text-left transition-colors",
                      isSelected
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-secondary/60 border border-transparent",
                    )}
                  >
                    {canCheck ? (
                      <span
                        role="checkbox"
                        aria-checked={checkedIds.has(cl.id)}
                        onClick={(e) => toggleCheck(cl.id, e)}
                        className={cn(
                          "size-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                          checkedIds.has(cl.id) ? "bg-primary border-primary" : "border-border hover:border-muted-foreground",
                        )}
                      >
                        {checkedIds.has(cl.id) && <Check className="size-2.5 text-primary-foreground" />}
                      </span>
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    <Avatar name={name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{lead?.title || lead?.email}</p>
                    </div>
                    {cl.attachment?.perLead && (
                      <Paperclip className="size-3 text-blue-400 shrink-0" aria-label={`Custom file: ${cl.attachment.perLead.name}`} />
                    )}
                    <span className={cn(
                      "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap",
                      "inline-flex items-center justify-center",
                      getStatusStyle(cl),
                    )}>
                      {getSidebarBadge(cl, isGenerating)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Draft review panel */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <p className="text-sm text-muted-foreground">Select a lead to review and certify their draft.</p>
            </div>
          ) : (
            <>
              {/* ── Lead name card — fixed, never scrolls ─────────────────── */}
              <div className="shrink-0 border-b border-border px-8 py-4 bg-card/30">
                <div className="max-w-2xl mx-auto">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (!selectedLead) return;
                      setDrawerLead({
                        id: selected.lead_id,
                        firstName: selectedLead.first_name ?? "",
                        lastName: selectedLead.last_name ?? "",
                        email: selectedLead.email ?? "",
                        company: "", domain: "", phone: "",
                        jobTitle: selectedLead.title ?? "",
                        country: selectedLead.country ?? "",
                        status: "Enriched", score: "—", source: "Apollo",
                        campaign: "", campaigns: [], createdAt: selected.created_at,
                        orgId: null, enrichmentStage: null, companyDescription: null,
                        sellsTo: null, lastError: null, hasScraped: false,
                        importId: null, batchLabel: null, batchColor: null,
                      });
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.currentTarget.click(); }}
                    className="w-full flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 text-left hover:bg-secondary/40 hover:border-primary/30 transition-all group cursor-pointer"
                  >
                    <Avatar name={selectedName} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-bold group-hover:text-primary transition-colors">{selectedName}</span>
                        <DraftStatusBadge
                          label={getDisplayStatus(selected)}
                          styleClass={getStatusStyle(selected)}
                          helpText={
                            selected.email_drafts?.status
                              ? (CAMPAIGN_STATUS_HELP[selected.email_drafts.status] ?? CAMPAIGN_STATUS_HELP.none)
                              : undefined
                          }
                        />
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground flex-wrap">
                        {selectedLead?.title && <span>{selectedLead.title}</span>}
                        {selectedLead?.title && selectedLead?.country && <span>·</span>}
                        {selectedLead?.country && <span>{selectedLead.country}</span>}
                        {selectedLead?.email && (
                          <>
                            {(selectedLead.title || selectedLead.country) && <span>·</span>}
                            <span className="font-mono">{selectedLead.email}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                  </div>
                </div>
              </div>

              {/* ── Email draft — scrollable ───────────────────────────────── */}
              <div className="flex-1 overflow-y-auto px-8 py-6">
              <div className="max-w-2xl mx-auto space-y-4">

                {selected.email_drafts?.status === "generating" || regenerating ? (
                  <div className="flex flex-col items-center py-20 gap-3 rounded-xl border border-border bg-card">
                    <Loader2 className="size-6 text-muted-foreground animate-spin" />
                    <p className="text-sm text-muted-foreground">Generating personalised email…</p>
                  </div>
                ) : selected.email_drafts ? (
                  <div className="space-y-4 rounded-xl border border-border bg-card p-6">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Subject</Label>
                      <Input
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        disabled={isPreviewingHistory || selected.email_drafts.status === "approved" || selected.email_drafts.status === "sent"}
                        className="font-medium text-base"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Body</Label>
                      <RichTextEditor
                        value={editBody}
                        onChange={setEditBody}
                        disabled={isPreviewingHistory || selected.email_drafts.status === "approved" || selected.email_drafts.status === "sent"}
                        minHeight={320}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                      {selected.email_drafts.status === "draft" && !isPreviewingHistory && (
                        <>
                          <Button variant="outline" className="gap-1.5" disabled={saving} onClick={handleSaveEdit}>
                            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                            Save edits
                          </Button>
                          <Button className="gap-1.5" disabled={certifying} onClick={() => handleCertifyOne(selected.email_drafts!.id)}>
                            {certifying ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                            Certify draft
                          </Button>
                        </>
                      )}
                      {selected.email_drafts.status === "approved" && !isPreviewingHistory && (
                        <>
                          <p className="text-sm text-green-400 flex items-center gap-1.5">
                            <CheckCircle2 className="size-4" /> Certified — ready to send
                          </p>
                          <Button variant="outline" className="gap-1.5" disabled={certifying} onClick={handleReopen}>
                            <RotateCcw className="size-3.5" /> Reopen for editing
                          </Button>
                        </>
                      )}
                      {["draft", "failed", "rejected"].includes(selected.email_drafts.status) && !isPreviewingHistory && (
                        <Button variant="outline" className="gap-1.5" onClick={() => setRegenOpen((o) => !o)}>
                          <RotateCcw className="size-3.5" /> Regenerate
                        </Button>
                      )}
                      {versions.length > 1 && (
                        <Button
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => setHistoryOpen((o) => !o)}
                        >
                          <History className="size-3.5" />
                          Version history
                          <ChevronDown className={cn("size-3.5 transition-transform", historyOpen && "rotate-180")} />
                        </Button>
                      )}
                    </div>

                    {historyOpen && versions.length > 1 && (
                      <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
                        <div className="flex flex-wrap gap-2">
                          {versions.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => loadVersionPreview(v)}
                              className={cn(
                                "text-xs rounded-lg border px-2.5 py-1.5 transition-colors",
                                (previewVersionId === v.id || (!previewVersionId && v.id === selected.email_drafts?.id))
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-secondary/30 text-muted-foreground hover:border-muted-foreground",
                              )}
                            >
                              v{v.version} · {format(new Date(v.created_at), "MMM d")}
                            </button>
                          ))}
                        </div>
                        {isPreviewingHistory && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xs text-amber-400">Viewing historical version (read-only)</p>
                            <Button size="sm" variant="outline" disabled={restoring} onClick={() => handleRestoreVersion(previewVersionId!)}>
                              {restoring ? <Loader2 className="size-3 animate-spin" /> : "Restore this version"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => {
                              setPreviewVersionId(null);
                              setEditSubject(selected.email_drafts?.subject ?? "");
                              setEditBody(selected.email_drafts?.body ?? "");
                            }}>
                              Back to current
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {regenOpen && (
                      <div className="rounded-lg border border-border bg-secondary/30 p-4 space-y-2">
                        <Input
                          value={regenQuery}
                          onChange={(e) => setRegenQuery(e.target.value)}
                          placeholder="Optional instruction, e.g. Make it shorter…"
                          onKeyDown={(e) => e.key === "Enter" && handleRegenerate()}
                        />
                        <Button size="sm" onClick={handleRegenerate} disabled={regenerating} className="gap-1.5">
                          <RotateCcw className="size-3.5" /> Regenerate
                        </Button>
                      </div>
                    )}

                    {/* Attachment panel */}
                    <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Paperclip className="size-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Attachment</span>
                      </div>

                      {selected.attachment?.effective ? (
                        <div className="flex items-center justify-between rounded-lg border border-border bg-background p-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="size-4 text-muted-foreground shrink-0" />
                            <span className="text-sm truncate">{selected.attachment.effective.name}</span>
                            {selected.attachment.effective.size != null && (
                              <span className="text-xs text-muted-foreground shrink-0">
                                ({selected.attachment.effective.size >= 1024 * 1024
                                  ? (selected.attachment.effective.size / 1024 / 1024).toFixed(1) + " MB"
                                  : Math.round(selected.attachment.effective.size / 1024) + " KB"})
                              </span>
                            )}
                            <span className={cn(
                              "ml-1 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              selected.attachment.effective.source === "lead"
                                ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                                : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                            )}>
                              {selected.attachment.effective.source === "lead" ? "This lead only" : "Campaign default"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {selected.attachment.effective.url && (
                              <button type="button"
                                      onClick={() => window.open(selected.attachment!.effective!.url!, "_blank")}
                                      className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/40 hover:border-blue-400/60 rounded-md px-2.5 py-1 transition-colors">
                                View
                              </button>
                            )}
                            <button type="button" onClick={() => leadFileRef.current?.click()}
                                    className="text-xs text-muted-foreground hover:text-foreground border border-border hover:border-border/80 rounded-md px-2.5 py-1 transition-colors">
                              Change
                            </button>
                            {selected.attachment.perLead && (
                              <button type="button" onClick={async () => {
                                const { data: { session } } = await supabase.auth.getSession();
                                if (!session) return;
                                await removeCampaignLeadAttachment(session.access_token, selected.id);
                                void loadData();
                              }}
                              className="text-xs text-red-400 hover:text-red-300 border border-red-500/40 hover:border-red-400/60 rounded-md px-2.5 py-1 transition-colors">
                                Use campaign default
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No attachment will be sent with this email.</p>
                      )}

                      <input ref={leadFileRef} type="file" className="hidden"
                             accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                             onChange={async (e) => {
                               const file = e.target.files?.[0];
                               if (!file) return;
                               if (file.size > 10 * 1024 * 1024) { setError("File exceeds 10MB"); return; }
                               setUploadingLeadAtt(true);
                               try {
                                 const { data: { session } } = await supabase.auth.getSession();
                                 if (!session) return;
                                 await uploadCampaignLeadAttachment(session.access_token, selected.id, file);
                                 void loadData();
                               } catch (err) {
                                 setError((err as Error).message);
                               } finally {
                                 setUploadingLeadAtt(false);
                                 if (leadFileRef.current) leadFileRef.current.value = "";
                               }
                             }} />
                      <Button variant="outline" size="sm" disabled={uploadingLeadAtt}
                              onClick={() => leadFileRef.current?.click()}
                              className="gap-1.5">
                        {uploadingLeadAtt ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                        {selected.attachment?.perLead ? "Replace file for this lead" : "Use a different file for this lead"}
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        Overrides the campaign attachment for this lead only. PDF, DOC, XLS, PNG, JPG · max 10MB.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card p-12 text-center">
                    <p className="text-sm text-muted-foreground">
                      {isGenerating ? "Draft is being generated…" : "No draft available for this lead."}
                    </p>
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {/* Lead detail drawer — opened when name card is clicked */}
      <LeadDrawer
        lead={drawerLead}
        onClose={() => setDrawerLead(null)}
        onOrgClick={(id) => { setDrawerLead(null); setDrawerOrgId(id); }}
      />
      <OrgDrawer
        orgId={drawerOrgId}
        onClose={() => setDrawerOrgId(null)}
      />
    </div>
  );
}

/** @deprecated Use CampaignDetail inline in page — kept for backwards compat */
export function CampaignDrawer({
  campaign,
  onClose,
}: {
  campaign: Campaign | null;
  onClose: () => void;
}) {
  if (!campaign) return null;
  return (
    <div className="fixed inset-0 z-40 bg-background">
      <CampaignDetail campaign={campaign} onBack={onClose} />
    </div>
  );
}
