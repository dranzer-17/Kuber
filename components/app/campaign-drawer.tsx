"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Megaphone, Users, Send, MessageSquare, Clock, Gauge,
  Globe, Calendar, ExternalLink, Loader2, CheckCircle2, RotateCcw, RefreshCw, Check, Save, History, ChevronDown, ChevronRight,
  List, LayoutGrid, BarChart2, Paperclip, FileText, Upload, Reply, Flame, Snowflake, ThumbsDown, X,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn, formatOrdinal } from "@/lib/utils";
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
  fetchDraftSiblings,
  fetchCampaignSteps,
  regenerateFollowUpDraft,
  saveFollowUpDraft,
  restoreDraftVersion,
  reopenDraft,
  fetchCampaignReport,
  retryFailedDrafts,
  uploadCampaignLeadAttachment,
  removeCampaignLeadAttachment,
  fetchCampaignReplies,
  syncCampaignReplies,
  editReplyDraft,
  approveReplyDraft,
  rejectReplyDraft,
  sendReplyDraft,
  regenerateReplyDraft,
  type CampaignReplyThread,
  type ReplyDraft,
} from "@/lib/api-client";
import { CampaignKanban } from "@/components/app/campaign-kanban";
import { CampaignReportView, type CampaignReportData } from "@/components/app/campaign-report";
import { ReplyDraftBox } from "@/components/app/reply-draft-box";
import { LeadDrawer } from "@/components/app/lead-drawer";
import { OrgDrawer } from "@/components/app/org-drawer";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/lib/app-context";
import type { Campaign } from "@/components/app/create-campaign-modal";
import { CampaignConfigModal } from "@/components/app/campaign-config-modal";
import { EditCampaignModal } from "@/components/app/edit-campaign-modal";
import { InfoTip } from "@/components/ui/info-tip";
import type { Lead } from "@/lib/leads";
import {
  DRAFT_BADGE_SHORT,
  CAMPAIGN_STATUS_HELP,
  CAMPAIGN_ACTION_HELP,
  type CampaignLeadsSort,
} from "@/lib/leads";

/**
 * Strips quoted-reply lines from a stored email plain-text body for display.
 * Handles both "> quoted" lines and "On [date]... wrote:" attribution lines.
 * Applied on the display side so it works for both old stored data (before the
 * webhook-side strip was added) and future data.
 */
function stripQuotedLines(text: string | null | undefined): string | null {
  if (!text) return null;
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith(">")) break;
    if (trimmed === "--" || trimmed === "\u2014") break;
    // "On ... wrote:" spanning 1-3 lines (Gmail wraps address across lines)
    if (/^On .+wrote:\s*$/.test(trimmed)) break;
    if (/^On .+/.test(trimmed)) {
      const next1 = lines[i + 1]?.trimStart() ?? "";
      const next2 = lines[i + 2]?.trimStart() ?? "";
      if (/wrote:\s*$/.test(next1) || /wrote:\s*$/.test(next2)) break;
    }
    kept.push(lines[i]);
  }
  return kept.join("\n").trim() || null;
}

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
  lead_temperature: string | null;
  created_at: string;
  leads: { first_name: string | null; last_name: string | null; email: string | null; title: string | null; country: string | null } | null;
  email_drafts: { id: string; subject: string | null; body: string | null; status: string; step_number?: number | null; created_at?: string } | null;
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

type CampaignViewTab = "list" | "kanban" | "report" | "replies";

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
  const [editOpen, setEditOpen] = useState(false);
  const [leadsSort, setLeadsSort] = useState<CampaignLeadsSort>("az");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: string; subject: string | null; body: string | null; status: string; version: number; created_at: string }>>([]);
  const [siblingSteps, setSiblingSteps] = useState<Array<{ id: string; step_number: number; subject: string | null; body: string | null; status: string; created_at: string }>>([]);
  const [campaignSteps, setCampaignSteps] = useState<Array<{ step_order: number; subject: string; body: string; delay: number; delay_unit: string }>>([]);
  const [activeFollowUpStep, setActiveFollowUpStep] = useState<number | null>(null);
  const [followUpBody, setFollowUpBody] = useState("");
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [regeneratingFollowUp, setRegeneratingFollowUp] = useState(false);
  const [followUpRegenOpen, setFollowUpRegenOpen] = useState(false);
  const [followUpRegenQuery, setFollowUpRegenQuery] = useState("");
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
  const [threads, setThreads] = useState<CampaignReplyThread[]>([]);
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [refreshingReplies, setRefreshingReplies] = useState(false);
  const [syncingReplies, setSyncingReplies] = useState(false);

  const [systemPromptUpdatedAt, setSystemPromptUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch("/api/v1/settings/prompt-meta", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      setSystemPromptUpdatedAt(json.data?.updatedAt ?? null);
    })();
  }, []);

  const { loadCampaigns, session: appSession } = useApp();

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

  const loadReplies = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { threads: t } = await fetchCampaignReplies(session.access_token, campaign.id);
    setThreads(t);
  }, [campaign.id]);

  useEffect(() => {
    setLoading(true);
    void loadReplies();
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

  const promptChangedSinceDraft = !!(
    systemPromptUpdatedAt &&
    selected?.email_drafts?.created_at &&
    new Date(systemPromptUpdatedAt) > new Date(selected.email_drafts.created_at)
  );

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

  useEffect(() => {
    if (!selected?.email_drafts?.id) { setSiblingSteps([]); return; }
    async function loadSiblings() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { siblings } = await fetchDraftSiblings(session.access_token, selected!.email_drafts!.id);
        setSiblingSteps(siblings);
      } catch { setSiblingSteps([]); }
    }
    void loadSiblings();
  }, [selected?.email_drafts?.id]);

  // Follow-up tabs default to the first configured follow-up step whenever
  // the selected lead changes (or campaign steps first load).
  useEffect(() => {
    const firstFollowUp = campaignSteps.find((s) => s.step_order > 1)?.step_order ?? null;
    setActiveFollowUpStep(firstFollowUp);
  }, [selected?.id, campaignSteps]);

  const activeFollowUpSibling = siblingSteps.find((s) => s.step_number === activeFollowUpStep) ?? null;
  const activeFollowUpTemplate = campaignSteps.find((s) => s.step_order === activeFollowUpStep) ?? null;

  // Seed the follow-up tab's editor from whichever draft actually exists for
  // that step, or from the campaign's generic step template if none exists
  // yet — always editable either way, so there's one single text box rather
  // than a separate read-only "template" state and "draft" state.
  useEffect(() => {
    if (activeFollowUpSibling) {
      setFollowUpBody(activeFollowUpSibling.body ?? "");
    } else {
      setFollowUpBody(fillTemplateTags(activeFollowUpTemplate?.body, selected?.leads));
    }
    setFollowUpRegenOpen(false);
    setFollowUpRegenQuery("");
  }, [activeFollowUpStep, activeFollowUpSibling?.id, activeFollowUpSibling?.body, activeFollowUpTemplate?.body, selected?.leads]);

  useEffect(() => {
    async function loadCampaignSteps() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { steps } = await fetchCampaignSteps(session.access_token, campaign.id);
        setCampaignSteps(steps.map((s) => ({ step_order: s.step_order, subject: s.subject, body: s.body, delay: s.delay, delay_unit: s.delay_unit })));
      } catch { setCampaignSteps([]); }
    }
    void loadCampaignSteps();
  }, [campaign.id]);

  // Sort days in calendar order (Mon–Sun) before display.
  // Object.entries() returns JSON key insertion order which is arbitrary.
  const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
  const activeDays = DAY_ORDER
    .filter((k) => campaign.sendDays?.[k])
    .map((k) => DAY_SHORT[k] ?? k);

  const draftReadyLeads = campaignLeads.filter((cl) => cl.email_drafts?.status === "draft");
  const certifiedCount = campaignLeads.filter((cl) =>
    (cl.email_drafts?.status === "approved" || cl.crm_status === "approved") &&
    cl.crm_status !== "sent"
  ).length;
  const isGenerating = progress ? (progress.generating + progress.pending) > 0 : false;
  const progressPct = progress && progress.total > 0
    ? Math.round(((progress.draft + progress.approved + progress.sent + progress.failed) / progress.total) * 100)
    : 0;
  const progressCompleted = progress
    ? progress.draft + progress.approved + progress.sent + progress.failed
    : 0;

  // Cosmetic only: the generic step template's preview substitutes merge tags
  // with this lead's real name so it doesn't read like raw template syntax.
  // Instantly does the actual substitution itself at send time regardless.
  function fillTemplateTags(text: string | null | undefined, lead: { first_name: string | null; last_name: string | null } | null | undefined): string {
    if (!text) return "";
    return text
      .replace(/\{\{\s*firstName\s*\}\}/gi, lead?.first_name?.trim() || "there")
      .replace(/\{\{\s*lastName\s*\}\}/gi, lead?.last_name?.trim() || "");
  }

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
      toast.success("Draft saved");
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
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
      toast.success("Draft reopened for editing");
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
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
      toast.success("Version restored");
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
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
      toast.success("Draft certified");
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
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
      toast.success(`${ids.length} draft${ids.length !== 1 ? "s" : ""} certified`);
      setCheckedIds(new Set());
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
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
      toast.success("Draft regenerated");
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  async function reloadSiblings() {
    if (!selected?.email_drafts?.id) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { siblings } = await fetchDraftSiblings(session.access_token, selected.email_drafts.id);
      setSiblingSteps(siblings);
    } catch { /* keep previous siblings on failure */ }
  }

  // Follow-up drafts never own campaign_leads.crm_status/draft_id (only step 1
  // does — see generateOneDraft), so there's no separate "Certify" step here:
  // Save persists + approves + syncs to Instantly in one call, via its own
  // isolated endpoint (not editDraft/approveDraft — see saveFollowUpDraft).
  // Works whether a draft row already exists or not (a manual write).
  async function handleSaveFollowUp() {
    if (!selected || activeFollowUpStep === null) return;
    setSavingFollowUp(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { instantly_sync } = await saveFollowUpDraft(
        session.access_token, campaign.id, selected.id, activeFollowUpStep, "", followUpBody,
      );
      if (instantly_sync.attempted && !instantly_sync.synced) {
        toast.error(`Saved, but didn't reach Instantly: ${instantly_sync.error ?? "unknown error"}`);
      } else {
        toast.success("Follow-up saved");
      }
      await reloadSiblings();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingFollowUp(false);
    }
  }

  // Regenerate is entirely isolated from the step-1 draft's regenerate flow
  // (see followup-regenerate/route.ts) — it only ever sees the current
  // follow-up text (whatever's in the box right now, whether that's an
  // existing AI draft, a manual edit, or the untouched generic template) plus
  // the typed instruction. No lead/org context, no product library re-mixed in.
  async function handleRegenerateFollowUp() {
    if (!selected || activeFollowUpStep === null) return;
    setRegeneratingFollowUp(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { draft } = await regenerateFollowUpDraft(
        session.access_token,
        campaign.id,
        selected.id,
        activeFollowUpStep,
        followUpBody,
        followUpRegenQuery || "Rewrite this follow-up.",
      );
      setFollowUpBody(draft.body ?? "");
      setFollowUpRegenOpen(false);
      setFollowUpRegenQuery("");
      toast.success("Follow-up regenerated");
      await reloadSiblings();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRegeneratingFollowUp(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const toSend = campaignLeads.filter((cl) =>
        (cl.crm_status === "approved" || cl.email_drafts?.status === "approved") &&
        cl.crm_status !== "sent"
      ).length;
      if (toSend === 0) {
        setError("No certified leads to send.");
        return;
      }
      const result = await sendApprovedLeads(session.access_token, campaign.id);
      if (result.sent === 0) {
        toast.error("No leads were sent to Instantly. Check timezone and sending window settings.");
        return;
      }
      toast.success(`${result.sent} lead${result.sent !== 1 ? "s" : ""} sent to Instantly`);
      await loadData();                                   // refresh this view's leads/drafts
      await loadCampaigns(session.access_token);          // refresh header stats + status badge
    } catch (e) {
      toast.error((e as Error).message);
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
      toast.success("Draft queued for regeneration");
      await loadData();
    } catch (e) {
      toast.error((e as Error).message);
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
        toast.error(errors[0] ?? "Retry failed");
      } else if (errors.length > 0) {
        toast.warning(`Retried ${retried}; ${errors.length} still failed`);
      } else {
        toast.success(`${retried} draft${retried !== 1 ? "s" : ""} queued for regeneration`);
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

  const selectedThread = threads.find((t) => t.thread_key === selectedThreadKey) ?? null;
  const selectedThreadLead = selectedThread?.lead;
  const selectedReplyName = selectedThreadLead
    ? [selectedThreadLead.first_name, selectedThreadLead.last_name].filter(Boolean).join(" ") || selectedThread?.lead_email || "Unknown"
    : selectedThread?.lead_email || "Unknown";

  const TEMP_BADGE: Record<string, { label: string; cls: string; icon?: React.ReactNode }> = {
    hot:          { label: "HOT",          cls: "bg-red-500/15 text-red-400 border-red-500/30",     icon: <Flame className="size-3" /> },
    warm:         { label: "WARM",         cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    cold:         { label: "COLD",         cls: "bg-sky-500/15 text-sky-400 border-sky-500/30",     icon: <Snowflake className="size-3" /> },
    neutral:      { label: "NEUTRAL",      cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
    ooo:          { label: "OUT OF OFFICE",cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    unsubscribed: { label: "UNSUBSCRIBED", cls: "bg-zinc-700/40 text-zinc-500 border-zinc-600/30" },
  };

  const pendingReplyDrafts = threads.reduce(
    (count, t) => count + t.messages.filter((m) => m.reply_drafts.some((d) => d.status === "draft")).length,
    0
  );
  const campaignTabs = [
    { id: "list" as const, label: "Leads", icon: List, count: campaign.leads },
    { id: "kanban" as const, label: "Kanban", icon: LayoutGrid },
    { id: "report" as const, label: "Report", icon: BarChart2 },
    { id: "replies" as const, label: "Replies", icon: Reply, count: threads.length || undefined },
  ];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b border-border px-8 py-3 shrink-0 bg-background space-y-3">
        <div className="flex items-center justify-between gap-4">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              <button
                type="button"
                onClick={onBack}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Campaigns
              </button>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-foreground font-medium">{campaign.name}</span>
          </nav>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
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

        <div className="flex min-w-0 items-center justify-between gap-6 border-t border-border pt-3">
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto text-xs">
              {[
                { label: "Leads", value: campaign.leads },
                { label: "Sent", value: campaign.sent },
                { label: "Replied", value: campaign.replied },
              ].map(({ label, value }) => (
                <span key={label} className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">{value}</span>
                  {label}
                </span>
              ))}
              {(campaign.hot ?? 0) > 0 && (
                <span className="inline-flex h-8 items-center gap-1 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 text-red-400">
                  <Flame className="size-3" />
                  <span className="font-semibold tabular-nums">{campaign.hot}</span> Hot
                </span>
              )}
              {(campaign.cold ?? 0) > 0 && (
                <span className="inline-flex h-8 items-center gap-1 rounded-md border border-sky-500/20 bg-sky-500/10 px-2.5 text-sky-400">
                  <Snowflake className="size-3" />
                  <span className="font-semibold tabular-nums">{campaign.cold}</span> Cold
                </span>
              )}
              {progress && progress.failed > 0 && (
                <span className="inline-flex h-8 items-center gap-1 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 text-red-400">
                  {progress.failed} failed
                  <InfoTip text={CAMPAIGN_STATUS_HELP.failed} />
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center gap-1 font-medium hover:text-red-300"
                    disabled={retryingAll}
                    onClick={() => void handleRetryAllFailed()}
                  >
                    {retryingAll ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                    Retry
                  </button>
                </span>
              )}
            </div>

            <div className="ml-auto flex shrink-0 items-center rounded-lg border border-border bg-card p-0.5">
            {campaignTabs.map(({ id, label, icon: Icon, count }) => {
              return (
              <button
                key={id}
                type="button"
                onClick={() => setViewTab(id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  viewTab === id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
                {typeof count === "number" && count > 0 && (
                  <span className={cn(
                    "min-w-4 rounded px-1 text-[10px] font-semibold tabular-nums",
                    viewTab === id ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
                  )}>
                    {count}
                  </span>
                )}
              </button>
              );
            })}
            </div>
        </div>
      </div>

      {viewTab === "replies" ? (
        <div className="flex flex-1 min-h-0">
          {/* Left: reply list */}
          <div className="w-72 shrink-0 border-r border-border flex flex-col">
            <div className="px-4 py-3 border-b border-border shrink-0 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Replies · {threads.length}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={syncingReplies || refreshingReplies}
                  onClick={async () => {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session) return;
                    setSyncingReplies(true);
                    try {
                      const result = await syncCampaignReplies(session.access_token, campaign.id);
                      if (result.backfilled > 0) {
                        toast.success(`Synced ${result.backfilled} missed repl${result.backfilled === 1 ? "y" : "ies"} from Instantly`);
                        await loadReplies();
                      } else {
                        toast.success("Already up to date");
                      }
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setSyncingReplies(false);
                    }
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={cn("size-3.5", syncingReplies && "animate-spin")} />
                  Sync
                </button>
                <button
                  type="button"
                  disabled={refreshingReplies}
                  onClick={async () => {
                    setRefreshingReplies(true);
                    try { await loadReplies(); } finally { setRefreshingReplies(false); }
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <RotateCcw className={cn("size-3.5", refreshingReplies && "animate-spin")} />
                  Refresh
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-border/40">
              {threads.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No replies received yet.
                </div>
              ) : threads.map((t) => {
                const lead = t.lead;
                const latestMsg = t.messages[t.messages.length - 1];
                const name = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") || t.lead_email : t.lead_email;
                const temp = t.latest_temperature ?? "neutral";
                const badge = TEMP_BADGE[temp] ?? TEMP_BADGE.neutral;
                const draftStatus = latestMsg?.reply_drafts[latestMsg.reply_drafts.length - 1]?.status;
                const isActive = selectedThreadKey === t.thread_key;
                return (
                  <button
                    key={t.thread_key}
                    type="button"
                    onClick={() => setSelectedThreadKey(t.thread_key)}
                    className={cn(
                      "w-full text-left px-4 py-3.5 transition-colors",
                      isActive ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-secondary/40 border-l-2 border-l-transparent",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <Avatar name={name ?? ""} size="sm" />
                      <span className="text-sm font-semibold truncate flex-1">{name}</span>
                      {t.messages.length > 1 && (
                        <span className="text-[10px] text-muted-foreground/70 shrink-0">({t.messages.length})</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-2 leading-relaxed">
                      {stripQuotedLines(latestMsg?.reply_body)}
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground/70">
                        {t.latest_received_at ? format(new Date(t.latest_received_at), "MMM d, h:mm a") : ""}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border inline-flex items-center gap-0.5", badge.cls)}>
                          {badge.icon}{badge.label}
                        </span>
                        {draftStatus && (
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", DRAFT_STATUS_STYLE[draftStatus] ?? "")}>
                            {draftStatus === "generating" ? "Drafting…" : draftStatus === "draft" ? "Ready" : draftStatus === "approved" ? "Approved" : draftStatus === "sent" ? "Sent ✓" : draftStatus}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: email thread */}
          <div className="flex-1 overflow-y-auto bg-secondary/10">
            {!selectedThread ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a reply to view the thread
              </div>
            ) : (
              <div className="w-full max-w-[1400px] mx-auto p-6 space-y-3">
                {/* Thread header */}
                <div className="flex items-center justify-between gap-3 pb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={selectedReplyName} size="md" />
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{selectedReplyName}</p>
                      <p className="text-xs text-muted-foreground truncate">{selectedThread.lead_email}</p>
                    </div>
                  </div>
                  {(() => {
                    const temp = selectedThread.latest_temperature ?? "neutral";
                    const badge = TEMP_BADGE[temp] ?? TEMP_BADGE.neutral;
                    return (
                      <span className={cn("text-xs font-semibold uppercase px-2.5 py-1 rounded-full border shrink-0 inline-flex items-center gap-1", badge.cls)}>
                        {badge.icon}{badge.label}
                      </span>
                    );
                  })()}
                </div>

                {/* Original outbound email — RIGHT bubble (first message in thread) */}
                {selectedThread.original_email && (
                  <div className="flex flex-col items-end gap-1">
                    <div className="max-w-[85%] space-y-1 items-end flex flex-col">
                      <div className="rounded-2xl rounded-br-sm bg-primary/10 border border-primary/20 px-4 py-3">
                        {selectedThread.original_email.subject && (
                          <p className="text-xs font-semibold text-primary mb-1.5">
                            {selectedThread.original_email.subject}
                          </p>
                        )}
                        <div
                          className="text-sm leading-relaxed text-foreground [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold"
                          dangerouslySetInnerHTML={{ __html: selectedThread.original_email.body ?? "" }}
                        />
                      </div>
                    </div>
                    <div className="size-7 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0 mb-0.5 text-[10px] font-bold text-primary">
                      K
                    </div>
                  </div>
                )}

                {/* Each inbound message + its reply draft */}
                {selectedThread.messages.map((msg) => {
                  const latestDraft = msg.reply_drafts[msg.reply_drafts.length - 1] ?? null;
                  return (
                    <div key={msg.id} className="space-y-3">
                      {/* Inbound message — LEFT bubble */}
                      <div className="flex items-end gap-2">
                        <div className="size-7 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0 mb-0.5 text-[10px] font-bold text-muted-foreground">
                          {selectedReplyName.charAt(0).toUpperCase()}
                        </div>
                        <div className="max-w-[85%] space-y-1">
                          <div className="rounded-2xl rounded-bl-sm bg-secondary border border-border px-4 py-3">
                            <p className="text-sm whitespace-pre-wrap leading-relaxed text-foreground">
                              {stripQuotedLines(msg.reply_body)}
                            </p>
                          </div>
                          <p className="text-[10px] text-muted-foreground/70 pl-1">
                            {msg.received_at ? format(new Date(msg.received_at), "MMM d, h:mm a") : ""}
                          </p>
                        </div>
                      </div>

                      {/* AI Reply draft for this message — RIGHT bubble */}
                      <div className="flex flex-col items-end gap-1">
                        {!latestDraft ? (
                          <div className="text-sm text-muted-foreground py-2 text-center w-full">No reply draft generated yet.</div>
                        ) : latestDraft.status === "generating" ? (
                          <div className="flex items-center gap-2.5 text-sm text-muted-foreground py-4 justify-center w-full">
                            <Loader2 className="size-4 animate-spin" /> Generating reply draft…
                          </div>
                        ) : latestDraft.status === "sent" ? (
                          <>
                            <div className="max-w-[85%] space-y-1 items-end flex flex-col">
                              <div className="rounded-2xl rounded-br-sm bg-primary/10 border border-primary/20 px-4 py-3">
                                <div
                                  className="text-sm leading-relaxed text-foreground [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold"
                                  dangerouslySetInnerHTML={{ __html: latestDraft.body ?? "" }}
                                />
                              </div>
                              <div className="flex items-center gap-1.5 pr-1">
                                <CheckCircle2 className="size-3 text-green-400" />
                                <p className="text-[10px] text-green-400">Sent</p>
                              </div>
                            </div>
                            <div className="size-7 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0 mb-0.5 text-[10px] font-bold text-primary">
                              K
                            </div>
                          </>
                        ) : (
                          <ReplyDraftBox
                            key={latestDraft.id}
                            draft={latestDraft}
                            token={appSession?.access_token ?? ""}
                            onChanged={() => void loadReplies()}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : viewTab === "report" ? (
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
        <div className="w-[360px] shrink-0 border-r border-border flex flex-col bg-card/40">
          <div className="px-4 py-3 border-b border-border shrink-0 bg-card/60">
            <div className="flex items-center justify-between mb-1 gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1">
                Leads ({campaign.leads})
                <InfoTip text="Select leads to certify individually, or use Certify all in the header." />
              </p>
              <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => setLeadsSort("az")}
                  className={cn(
                    "flex items-center px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors",
                    leadsSort === "az" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  A–Z
                </button>
                <button
                  type="button"
                  onClick={() => setLeadsSort("newest")}
                  className={cn(
                    "flex items-center px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors",
                    leadsSort === "newest" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Newest
                </button>
              </div>
            </div>
            {(draftReadyLeads.length > 0 || checkedDraftCount > 0) && (
              <div className="flex items-center justify-between gap-2 mt-2">
                <button
                  type="button"
                  onClick={toggleAllDraftReady}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {draftReadyLeads.every((cl) => checkedIds.has(cl.id)) ? "Deselect all" : "Select all draft-ready"}
                </button>
                {checkedDraftCount > 0 && (
                  <div className="flex items-center gap-1">
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
                    </Button>
                    <InfoTip text={CAMPAIGN_ACTION_HELP.certifySelected} />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
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
                const canCheck = ["draft", "approved"].includes(cl.email_drafts?.status ?? "");
                return (
                  <button
                    key={cl.id}
                    type="button"
                    onClick={() => setSelectedId(cl.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors",
                      isSelected
                        ? "bg-primary/10 border border-primary/30 shadow-sm"
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

          <div className="shrink-0 border-t border-border bg-card/60 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                {progress && progress.total > 0 && progressCompleted < progress.total ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    <span><span className="font-medium text-foreground">{progressCompleted}</span> of {progress.total} ready</span>
                  </p>
                ) : progress && progress.total > 0 ? (
                  <p className="flex items-center gap-1.5 text-xs text-green-500">
                    <CheckCircle2 className="size-3.5" /> {progress.total} ready
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">No draft progress yet</p>
                )}
                {isGenerating && (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-500">
                    <Loader2 className="size-3 animate-spin" /> Generating drafts
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Edit
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setConfigOpen((o) => !o)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <Gauge className="size-3.5" />
                    Config
                  </button>
                  {configOpen && <CampaignConfigModal campaign={campaign} open={configOpen} />}
                </div>
              </div>
              <EditCampaignModal
                open={editOpen}
                onClose={() => setEditOpen(false)}
                campaign={campaign}
              />
            </div>
          </div>
        </div>

        {/* Draft review panel */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-secondary/10">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <p className="text-sm text-muted-foreground">Select a lead to review and certify their draft.</p>
            </div>
          ) : (
            <>
              {/* ── Lead name card — fixed, never scrolls ─────────────────── */}
              <div className="shrink-0 border-b border-border px-6 py-3 bg-background">
                <div className="max-w-4xl mx-auto">
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
                    className="w-full flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left hover:bg-secondary/40 hover:border-primary/30 transition-all group cursor-pointer"
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
              <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="max-w-4xl mx-auto space-y-4">

                {selected.email_drafts?.status === "generating" || regenerating ? (
                  <div className="flex flex-col items-center py-20 gap-3 rounded-lg border border-border bg-card">
                    <Loader2 className="size-6 text-muted-foreground animate-spin" />
                    <p className="text-sm text-muted-foreground">Generating personalised email…</p>
                  </div>
                ) : selected.email_drafts ? (
                  <div className="space-y-4 rounded-lg border border-border bg-card p-5">
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
                        minHeight={520}
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
                      {["draft", "failed", "rejected"].includes(selected.email_drafts.status) && !isPreviewingHistory && promptChangedSinceDraft && (
                        <Button
                          variant="outline"
                          className="gap-1.5 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                          disabled={regenerating}
                          onClick={async () => {
                            setRegenerating(true); setError("");
                            try {
                              const { data: { session } } = await supabase.auth.getSession();
                              if (!session || !selected?.email_drafts?.id) return;
                              const { draft } = await regenerateDraft(session.access_token, selected.email_drafts.id);
                              setEditSubject(draft.subject ?? "");
                              setEditBody(draft.body ?? "");
                              await loadData();
                            } catch (e) { setError((e as Error).message); }
                            finally { setRegenerating(false); }
                          }}
                        >
                          <RotateCcw className="size-3.5" /> Regenerate using new System Prompt
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

                    {/* Follow-up tabs — entirely self-contained below the sent email above,
                        never touching it or campaign_leads.crm_status. Tabs = this campaign's
                        configured follow-up steps. A tab with no draft yet for this lead shows
                        Instantly's own generic step template (read-only) with a Generate button;
                        once generated, it becomes an editable mini-panel (Save persists + approves
                        in one action — no separate Certify step here — plus Regenerate). Never a
                        "version" of the draft above — a different email later in the sequence. */}
                    {selected.email_drafts?.status === "sent" && selected.crm_status !== "replied" && campaignSteps.some((s) => s.step_order > 1) && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                            Follow-up templates
                          </Label>
                          <InfoTip text="Each tab is one follow-up step configured for this campaign. Generate or write this lead's version here, independent of the initial email above — editing or regenerating a follow-up never affects the sent draft or this lead's status." />
                        </div>
                        <div className="rounded-lg border border-border bg-secondary/10 overflow-hidden">
                        <div className="flex items-center gap-1 border-b border-border px-2 pt-2 overflow-x-auto">
                          {campaignSteps.filter((s) => s.step_order > 1).map((s) => {
                            // Delay is stored shifted back one step (step N's delay is the
                            // wait before step N+1 — see lib/constants.ts buildDefaultCampaignSteps),
                            // so THIS step's own "sends after" wait lives on the previous step.
                            const waitStep = campaignSteps.find((p) => p.step_order === s.step_order - 1);
                            return (
                              <button
                                key={s.step_order}
                                type="button"
                                onClick={() => setActiveFollowUpStep(s.step_order)}
                                className={cn(
                                  "flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap",
                                  activeFollowUpStep === s.step_order
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted-foreground hover:text-foreground",
                                )}
                              >
                                <span>{formatOrdinal(s.step_order - 1)} follow-up</span>
                                {waitStep && (
                                  <span className="text-[10px] font-normal text-muted-foreground/70">
                                    {waitStep.delay} {waitStep.delay_unit} later
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>

                        <div className="p-3.5 space-y-2.5">
                          {activeFollowUpSibling?.status === "sent" ? (
                            <>
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-medium text-muted-foreground">{activeFollowUpSibling.subject}</p>
                                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
                                  Sent
                                </span>
                              </div>
                              <div
                                className="text-xs text-muted-foreground prose-sm max-w-none [&_p]:my-1.5"
                                dangerouslySetInnerHTML={{ __html: activeFollowUpSibling.body ?? "" }}
                              />
                            </>
                          ) : (
                            <>
                              <span className="inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
                                Generic template — edit freely or hit Regenerate
                              </span>
                              <RichTextEditor
                                value={followUpBody}
                                onChange={setFollowUpBody}
                                minHeight={180}
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="gap-1.5"
                                  disabled={savingFollowUp}
                                  onClick={handleSaveFollowUp}
                                >
                                  {savingFollowUp ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5"
                                  onClick={() => setFollowUpRegenOpen((o) => !o)}
                                >
                                  <RotateCcw className="size-3.5" />
                                  Regenerate
                                </Button>
                              </div>
                              {followUpRegenOpen && (
                                <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
                                  <Input
                                    value={followUpRegenQuery}
                                    onChange={(e) => setFollowUpRegenQuery(e.target.value)}
                                    placeholder="Optional instruction, e.g. Make it shorter…"
                                    onKeyDown={(e) => e.key === "Enter" && handleRegenerateFollowUp()}
                                  />
                                  <Button
                                    size="sm"
                                    className="gap-1.5"
                                    disabled={regeneratingFollowUp}
                                    onClick={handleRegenerateFollowUp}
                                  >
                                    {regeneratingFollowUp ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                                    Regenerate
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        </div>
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
        onLeadClick={(leadId) => {
          setDrawerOrgId(null);
          setDrawerLead({ id: leadId, firstName: "", lastName: "", email: "", company: "", domain: "", phone: "", jobTitle: "", country: "", status: "Enriched", score: "—", source: "Apollo", campaign: "", campaigns: [], createdAt: new Date().toISOString(), orgId: null, enrichmentStage: null, companyDescription: null, sellsTo: null, lastError: null, hasScraped: false, importId: null, batchLabel: null, batchColor: null });
        }}
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
