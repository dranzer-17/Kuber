"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Megaphone, Users, Send, MessageSquare, Clock, Gauge,
  Globe, Calendar, ExternalLink, Loader2, CheckCircle2, RotateCcw, RefreshCw, Check, Save, History, ChevronDown, ChevronRight, ArrowLeft,
  List, LayoutGrid, BarChart2, Paperclip, FileText, Upload, Reply, Flame, Snowflake, ThumbsDown, X, Search, Layers,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
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
  fetchCampaignSteps,
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
  saveCampaignSteps,
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
import { EditCampaignForm } from "@/components/app/edit-campaign-modal";
import { InfoTip } from "@/components/ui/info-tip";
import type { Lead } from "@/lib/leads";
import {
  DRAFT_BADGE_SHORT,
  CAMPAIGN_STATUS_HELP,
  CAMPAIGN_ACTION_HELP,
  type CampaignLeadsSort,
} from "@/lib/leads";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from "recharts";

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
    if (trimmed === "--" || trimmed === "—") break;
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
  leads: { first_name: string | null; last_name: string | null; email: string | null; title: string | null; country: string | null; company_name: string | null } | null;
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

type EmailDraftRow = NonNullable<CampaignLead["email_drafts"]>;

/** Instantly step templates use {{customSubject}} / {{customBodyN}} — not display text. */
function isInstantlyPlaceholder(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return /^\{\{custom(?:Subject|Body)\d*\}\}$/.test(value.trim());
}

function getLeadDrafts(cl: CampaignLead): EmailDraftRow[] {
  const raw = cl.email_drafts as unknown;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as EmailDraftRow[];
  return [raw as EmailDraftRow];
}

function getLeadDraftForStep(cl: CampaignLead, stepNumber: number): EmailDraftRow | null {
  return getLeadDrafts(cl).find((d) => (d.step_number ?? 1) === stepNumber) ?? null;
}

function findSampleDraftForStep(leads: CampaignLead[], stepNumber: number): EmailDraftRow | null {
  for (const cl of leads) {
    const d = getLeadDraftForStep(cl, stepNumber);
    if (d?.body) return d;
  }
  return null;
}

/** Old sequences-tab default that looked like a second initial email — never treat as real content. */
const LEGACY_MISLEADING_FOLLOWUP_SUBJECT =
  "Introduction: Kuber Polyplast | Masterbatch Solutions for Packaging Manufacturers";

const GENERIC_FOLLOWUP_BODY =
  "Hi {{firstName}},\n\nJust following up on my previous note — would love your thoughts.\n\nBest regards";

function fillTemplateTags(
  text: string | null | undefined,
  lead: { first_name: string | null; last_name: string | null } | null | undefined,
): string {
  if (!text) return "";
  return text
    .replace(/\{\{\s*firstName\s*\}\}/gi, lead?.first_name?.trim() || "there")
    .replace(/\{\{\s*lastName\s*\}\}/gi, lead?.last_name?.trim() || "");
}

function sequenceStepSubtitle(
  step: { step_order: number; subject: string; body: string },
  leads: CampaignLead[],
): string | null {
  const displayStep = step.step_order - 1;
  const draft = findSampleDraftForStep(leads, step.step_order);
  const subject = (draft?.subject ?? step.subject)?.trim();
  if (subject && !isInstantlyPlaceholder(subject) && subject !== LEGACY_MISLEADING_FOLLOWUP_SUBJECT) {
    return subject;
  }
  if (draft?.body) return `Step ${displayStep}`;
  return `Step ${displayStep} (threaded reply)`;
}

/** Campaign steps shown in the Sequences tab (initial email is edited under Drafts). */
function sequenceFollowUpSteps(
  steps: Array<{ step_order: number; subject: string; body: string; delay: number; delay_unit: string }>,
) {
  return steps.filter((s) => s.step_order > 1);
}

function sequenceDisplayStep(stepOrder: number): number {
  return stepOrder - 1;
}

function getSidebarBadge(cl: CampaignLead, isGenerating: boolean): string {
  const ds = cl.email_drafts?.status;
  if (ds && DRAFT_BADGE_SHORT[ds]) return DRAFT_BADGE_SHORT[ds];
  if (cl.crm_status === "new" || cl.crm_status === "enriched") {
    return isGenerating ? "Pending" : "Pending";
  }
  return "—";
}

type CampaignViewTab = "analytics" | "leads" | "kanban" | "drafts" | "sequences" | "options" | "replies";

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
  const [campaignSteps, setCampaignSteps] = useState<Array<{ step_order: number; subject: string; body: string; delay: number; delay_unit: string }>>([]);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [viewTab, setViewTab] = useState<CampaignViewTab>("analytics");
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
  const [syncingReplies, setSyncingReplies] = useState(false);
  const syncHitTimesRef = useRef<number[]>([]);
  const SYNC_RATE_LIMIT = 10;
  const SYNC_RATE_WINDOW_MS = 60_000;
  const [leadsSearch, setLeadsSearch] = useState("");
  const [selectedSequenceStep, setSelectedSequenceStep] = useState<number>(2);
  const [sequencesLoading, setSequencesLoading] = useState(false);
  // seq edit state — initialized when selectedSequenceStep changes
  const [seqSubjectEdit, setSeqSubjectEdit] = useState("");
  const [seqBodyEdit, setSeqBodyEdit] = useState("");
  const [seqHasContent, setSeqHasContent] = useState(false);
  const [seqStepSaving, setSeqStepSaving] = useState(false);

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
    const leads = (leadsRes.campaign_leads as CampaignLead[]).map((cl) => {
      const step1Draft = getLeadDraftForStep(cl, 1);
      return step1Draft ? { ...cl, email_drafts: step1Draft } : { ...cl, email_drafts: null };
    });
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
    if (viewTab !== "analytics") return;
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
    if (viewTab !== "sequences") return;
    let cancelled = false;
    setSequencesLoading(true);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      try {
        const { steps } = await fetchCampaignSteps(session.access_token, campaign.id);
        if (!cancelled) {
          const mapped = steps.map((s) => ({ step_order: s.step_order, subject: s.subject, body: s.body, delay: s.delay, delay_unit: s.delay_unit }));
          setCampaignSteps(mapped);
          const followUps = mapped.filter((s) => s.step_order > 1);
          if (followUps.length > 0) {
            setSelectedSequenceStep((prev) =>
              followUps.some((s) => s.step_order === prev) ? prev : followUps[0].step_order,
            );
          }
        }
      } catch {
        if (!cancelled) setCampaignSteps([]);
      } finally {
        if (!cancelled) setSequencesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [viewTab, campaign.id]);

  // Initialize sequence step edit state (follow-up steps only — initial email lives under Drafts).
  useEffect(() => {
    if (viewTab !== "sequences") return;
    const followUps = sequenceFollowUpSteps(campaignSteps);
    const step = followUps.find((s) => s.step_order === selectedSequenceStep) ?? followUps[0];
    if (!step) return;

    const stepNum = step.step_order;
    const sampleLead = campaignLeads.find((cl) => getLeadDraftForStep(cl, stepNum)?.body);
    const sampleDraft = sampleLead ? getLeadDraftForStep(sampleLead, stepNum) : null;
    const rawBody = step.body ?? "";
    const rawSubject = step.subject ?? "";
    const isPlaceholder = isInstantlyPlaceholder(rawBody);
    const subject =
      sampleDraft?.subject ??
      (rawSubject && rawSubject !== LEGACY_MISLEADING_FOLLOWUP_SUBJECT ? rawSubject : "");
    const body =
      sampleDraft?.body ??
      (isPlaceholder || !rawBody
        ? fillTemplateTags(GENERIC_FOLLOWUP_BODY, sampleLead?.leads ?? campaignLeads[0]?.leads)
        : rawBody);
    setSeqSubjectEdit(subject);
    setSeqBodyEdit(body);
    setSeqHasContent(true);
    setSeqStepSaving(false);
  }, [viewTab, selectedSequenceStep, campaignSteps, campaignLeads]);

  useEffect(() => {
    if (!progress) return;
    const isGenerating = (progress.generating + progress.pending) > 0;
    if (!isGenerating) return;
    const interval = setInterval(() => { void loadData(); }, 3000);
    return () => clearInterval(interval);
  }, [progress, loadData]);

  const selected = campaignLeads.find((cl) => cl.id === selectedId) ?? null;
  const leadPanelOpen = selectedId !== null;
  const [panelLead, setPanelLead] = useState<CampaignLead | null>(null);
  useEffect(() => {
    if (selected) setPanelLead(selected);
  }, [selected]);
  const panel = panelLead ?? selected;

  useEffect(() => {
    if (!leadPanelOpen) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [leadPanelOpen]);

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
  const sendReadyLeads = campaignLeads.filter((cl) =>
    (cl.email_drafts?.status === "approved" || cl.crm_status === "approved") &&
    cl.email_drafts?.status !== "sent" &&
    cl.crm_status !== "sent"
  );
  const certifiedCount = sendReadyLeads.length;
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

  function toggleAllSendReady() {
    const ids = sendReadyLeads.map((cl) => cl.id);
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

  async function handleSend(campaignLeadIds?: string[]) {
    setSending(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const toSend = campaignLeadIds?.length ?? sendReadyLeads.length;
      if (toSend === 0) {
        setError("No certified leads to send.");
        return;
      }
      const result = await sendApprovedLeads(
        session.access_token,
        campaign.id,
        campaignLeadIds?.length ? { campaignLeadIds } : undefined,
      );
      if (result.sent === 0) {
        toast.error("No leads were sent to Instantly. Check timezone and sending window settings.");
        return;
      }
      toast.success(`${result.sent} lead${result.sent !== 1 ? "s" : ""} sent to Instantly`);
      setCheckedIds(new Set());
      await loadData();
      await loadCampaigns(session.access_token);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function handlePrimaryAction() {
    if (checkedDraftCount > 0) {
      await handleBulkCertify(
        campaignLeads
          .filter((cl) => checkedIds.has(cl.id) && cl.email_drafts?.status === "draft")
          .map((cl) => cl.email_drafts!.id),
      );
      return;
    }
    if (checkedSendCount > 0) {
      const ids = campaignLeads
        .filter((cl) => checkedIds.has(cl.id) && sendReadyLeads.some((s) => s.id === cl.id))
        .map((cl) => cl.id);
      await handleSend(ids);
      return;
    }
    await handleSend();
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
      if (viewTab === "analytics") {
        const data = await fetchCampaignReport(session.access_token, campaign.id);
        setReport(data);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetryingAll(false);
    }
  }

  async function handleSaveSeqDraft() {
    if (!activeSeqStep) return;
    setSeqStepSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const stepNum = activeSeqStep.step_order;
      const subject =
        seqSubjectEdit.trim() === LEGACY_MISLEADING_FOLLOWUP_SUBJECT ? "" : seqSubjectEdit;
      const updatedSteps = campaignSteps.map((s) =>
        s.step_order === stepNum
          ? { ...s, subject, body: seqBodyEdit }
          : s,
      );
      await saveCampaignSteps(session.access_token, campaign.id, updatedSteps);
      setCampaignSteps(updatedSteps);
      toast.success("Saved");
    } catch (e) {
      toast.error("Failed to save: " + (e as Error).message);
    } finally {
      setSeqStepSaving(false);
    }
  }

  function handleKanbanSelect(campaignLeadId: string) {
    setSelectedId(campaignLeadId);
    setViewTab("leads");
  }

  const checkedDraftCount = campaignLeads.filter(
    (cl) => checkedIds.has(cl.id) && cl.email_drafts?.status === "draft"
  ).length;

  const checkedSendCount = campaignLeads.filter(
    (cl) => checkedIds.has(cl.id) && sendReadyLeads.some((s) => s.id === cl.id)
  ).length;

  const primaryAction =
    checkedDraftCount > 0
      ? { mode: "certify" as const, count: checkedDraftCount }
      : checkedSendCount > 0
        ? { mode: "send" as const, count: checkedSendCount }
        : certifiedCount > 0
          ? { mode: "sendAll" as const, count: certifiedCount }
          : { mode: "none" as const, count: 0 };

  const primaryBusy = primaryAction.mode === "certify" ? certifying : sending;
  const primaryLabel = primaryBusy
    ? primaryAction.mode === "certify" ? "Certifying…" : "Sending…"
    : primaryAction.mode === "certify"
      ? `Certify (${primaryAction.count})`
      : primaryAction.mode === "send"
        ? `Send (${primaryAction.count})`
        : primaryAction.mode === "sendAll"
          ? `Send all (${primaryAction.count})`
          : "Send all (0)";

  const sortedCampaignLeads = sortCampaignLeads(campaignLeads, leadsSort);

  const filteredLeads = sortedCampaignLeads.filter((cl) => {
    if (!leadsSearch) return true;
    const name = [cl.leads?.first_name, cl.leads?.last_name].filter(Boolean).join(" ").toLowerCase();
    const email = (cl.leads?.email ?? "").toLowerCase();
    const q = leadsSearch.toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  const selectedLead = panel?.leads;
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

  const campaignTabs: Array<{ id: CampaignViewTab; label: string; icon?: React.ComponentType<{ className?: string }>; count?: number }> = [
    { id: "analytics", label: "Analytics", icon: BarChart2 },
    { id: "leads",     label: "Leads",     icon: List,        count: campaign.leads },
    { id: "drafts",    label: "Drafts",    icon: FileText },
    { id: "sequences", label: "Sequences", icon: Layers },
    { id: "options",   label: "Options",   icon: Gauge },
    { id: "replies",   label: "Replies",   icon: Reply,       count: threads.length || undefined },
  ];

  // Computed for sequences tab (follow-up steps only)
  const seqFollowUpSteps = sequenceFollowUpSteps(campaignSteps);
  const activeSeqStep =
    seqFollowUpSteps.find((s) => s.step_order === selectedSequenceStep) ??
    seqFollowUpSteps[0] ??
    null;

  // Status badge info for analytics tab
  const statusBadge = (() => {
    switch (campaign.status) {
      case "Live":      return { label: "Active",    cls: "bg-green-500/15 text-green-500 border-green-500/30" };
      case "Paused":    return { label: "Paused",    cls: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30" };
      case "Scheduled": return { label: "Scheduled", cls: "bg-blue-500/15 text-blue-500 border-blue-500/30" };
      default:          return { label: "Draft",     cls: "bg-muted text-muted-foreground border-border" };
    }
  })();

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 bg-background border-b border-border flex items-center justify-between gap-4 px-6 h-14">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted shrink-0"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h1 className="text-sm font-semibold text-foreground truncate min-w-0">{campaign.name}</h1>
        </div>

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
            disabled={primaryBusy || certifying || sending || primaryAction.mode === "none"}
            onClick={() => void handlePrimaryAction()}
          >
            {primaryBusy ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
            {primaryLabel}
          </Button>
        </div>
      </div>

      {/* ── Tab navigation — pill style ──────────────────────────────────── */}
      <div className="shrink-0 border-b border-border px-6 py-3">
        <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/40 p-1">
          {campaignTabs.map(({ id, label, icon: Icon, count }) => {
            const isActive = viewTab === id || (id === "analytics" && viewTab === "kanban");
            return (
              <button
                key={id}
                type="button"
                onClick={() => setViewTab(id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {Icon && <Icon className="size-3.5" />}
                {label}
                {typeof count === "number" && count > 0 && (
                  <span className={cn(
                    "min-w-[18px] rounded-full px-1 text-[10px] font-semibold tabular-nums text-center",
                    isActive ? "bg-primary/20 text-primary" : "bg-border text-muted-foreground",
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}

      {/* ── Analytics ─────────────────────────────────────────────────────── */}
      {(viewTab === "analytics" || viewTab === "kanban") && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          {/* ── Analytics/Kanban toggle ── */}
          <div className="px-6 pt-3 pb-2 flex items-center justify-end gap-2">
            {progress && progress.failed > 0 && (
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-red-500/30 bg-background px-2.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                disabled={retryingAll}
                onClick={() => void handleRetryAllFailed()}
              >
                {retryingAll ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                Retry ({progress.failed})
              </button>
            )}
            <div className="inline-flex items-center rounded-full border border-border bg-muted/40 p-1 gap-0.5">
              <button
                type="button"
                onClick={() => setViewTab("analytics")}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full px-3 text-xs font-medium transition-all",
                  viewTab === "analytics" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <BarChart2 className="size-3" /> Analytics
              </button>
              <button
                type="button"
                onClick={() => setViewTab("kanban")}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full px-3 text-xs font-medium transition-all",
                  viewTab === "kanban" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutGrid className="size-3" /> Kanban
              </button>
            </div>
          </div>

          {viewTab === "kanban" ? (
            /* ── Kanban view ── */
            <div className="flex flex-col flex-1 min-h-0 bg-card/30">
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
            /* ── Analytics view ── */
            <div className="px-6 pb-4 flex flex-col gap-3">
              {/* Stat strip */}
              <div className="flex items-stretch border border-border rounded-lg overflow-hidden">
                {[
                  { label: "Leads",   value: campaign.leads,       cls: "text-foreground" },
                  { label: "Sent",    value: campaign.sent,        cls: "text-primary" },
                  { label: "Replied", value: campaign.replied,     cls: "text-primary" },
                  { label: "Hot",     value: campaign.hot ?? 0,    cls: "text-red-500" },
                  { label: "Cold",    value: campaign.cold ?? 0,   cls: "text-sky-500" },
                ].map(({ label, value, cls }, i, arr) => (
                  <div key={label} className={cn("flex-1 flex flex-col items-center justify-center py-2 bg-card", i < arr.length - 1 && "border-r border-border")}>
                    <span className={cn("text-xl font-bold tabular-nums leading-tight", cls)}>{value}</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">{label}</span>
                    {i > 0 && (
                      <span className="text-[9px] text-muted-foreground/50 tabular-nums">
                        {campaign.leads > 0 ? `${Math.round((Number(value) / campaign.leads) * 100)}%` : "–"}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Two-column charts */}
              <div className="grid grid-cols-2 gap-3">
                {/* Pipeline pie chart */}
                <div className="rounded-lg border border-border bg-card px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Pipeline</p>
                  {(() => {
                    const sent = campaign.sent ?? 0;
                    const replied = campaign.replied ?? 0;
                    const hot = campaign.hot ?? 0;
                    const cold = campaign.cold ?? 0;
                    const pending = Math.max(0, campaign.leads - sent);
                    const segments = [
                      { name: "Replied", value: replied,  fill: "#22c55e" },
                      { name: "Sent",    value: Math.max(0, sent - replied), fill: "hsl(var(--primary))" },
                      { name: "Hot",     value: hot,      fill: "#ef4444" },
                      { name: "Cold",    value: cold,     fill: "#0ea5e9" },
                      { name: "Pending", value: pending,  fill: "hsl(var(--muted-foreground) / 0.3)" },
                    ].filter((s) => s.value > 0);
                    if (segments.length === 0) segments.push({ name: "No data", value: 1, fill: "hsl(var(--muted))" });
                    return (
                      <ResponsiveContainer width="100%" height={120}>
                        <PieChart>
                          <Pie data={segments} cx="50%" cy="50%" innerRadius={32} outerRadius={52} dataKey="value" stroke="none">
                            {segments.map((s, i) => <Cell key={i} fill={s.fill} />)}
                          </Pie>
                          <Tooltip
                            content={({ active, payload }) =>
                              active && payload?.length ? (
                                <div className="rounded border border-border bg-card px-2 py-1 text-xs shadow-lg">
                                  <span className="font-semibold">{payload[0].name}: </span>
                                  <span>{payload[0].value}</span>
                                </div>
                              ) : null
                            }
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    );
                  })()}
                </div>

                {/* Draft bar chart */}
                {report ? (
                  <div className="rounded-lg border border-border bg-card px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Drafts</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <BarChart
                        data={[
                          { name: "Leads",  v: report.totals.leads },
                          { name: "Gen",    v: report.totals.draftsGenerated },
                          { name: "Cert",   v: report.totals.certified },
                          { name: "Sent",   v: report.totals.sent },
                          { name: "Failed", v: report.totals.failed },
                        ]}
                        margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                      >
                        <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip
                          content={({ active, payload, label }) =>
                            active && payload?.length ? (
                              <div className="rounded border border-border bg-card px-2 py-1 text-xs shadow-lg">
                                <span className="font-semibold">{label}: </span>
                                <span>{payload[0].value}</span>
                              </div>
                            ) : null
                          }
                        />
                        <Bar dataKey="v" radius={[3, 3, 0, 0]}>
                          {[
                            "hsl(var(--muted-foreground))",
                            "hsl(var(--primary))",
                            "hsl(var(--primary) / 0.7)",
                            "#22c55e",
                            "#ef4444",
                          ].map((fill, i) => <Cell key={i} fill={fill} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : reportLoading ? (
                  <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-center">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Leads (full-width table + LeadDrawer-style panel) ─────────────── */}
      {viewTab === "leads" && (
        <>
        <div className="flex flex-col flex-1 min-h-0">
          {/* Header row */}
          <div className="px-6 py-3 border-b border-border shrink-0 flex items-center gap-3 flex-wrap bg-background">
            {/* Search */}
            <div className="relative flex-1 min-w-36 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={leadsSearch}
                onChange={(e) => setLeadsSearch(e.target.value)}
                placeholder="Search leads…"
                className="pl-8 h-8 text-xs"
              />
            </div>

            {/* Sort pills */}
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

            {draftReadyLeads.length > 0 && (
              <button
                type="button"
                onClick={toggleAllDraftReady}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                {draftReadyLeads.every((cl) => checkedIds.has(cl.id)) ? "Deselect all" : "Select all draft-ready"}
              </button>
            )}
            {sendReadyLeads.length > 0 && (
              <button
                type="button"
                onClick={toggleAllSendReady}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                {sendReadyLeads.every((cl) => checkedIds.has(cl.id)) ? "Deselect all" : "Select all send-ready"}
              </button>
            )}
          </div>

          {/* Table */}
          <div className="flex-1 min-h-0 overflow-y-auto">
              {loading ? (
                <div className="p-4 space-y-2 animate-pulse">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-10 bg-muted rounded" />
                  ))}
                </div>
              ) : filteredLeads.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  {leadsSearch ? "No leads match your search." : "No leads yet."}
                </div>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b border-border">
                      <th className="w-10 px-3 py-2.5 text-left" />
                      <th className="w-10 px-2 py-2.5 text-left text-xs text-muted-foreground font-medium">#</th>
                      <th className="px-3 py-2.5 text-left text-xs text-muted-foreground font-medium">NAME</th>
                      <th className="px-3 py-2.5 text-left text-xs text-muted-foreground font-medium">EMAIL</th>
                      <th className="px-3 py-2.5 text-left text-xs text-muted-foreground font-medium">JOB TITLE</th>
                      <th className="px-3 py-2.5 text-left text-xs text-muted-foreground font-medium">STATUS</th>
                      <th className="px-3 py-2.5 text-left text-xs text-muted-foreground font-medium">COMPANY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.map((cl, index) => {
                      const lead = cl.leads;
                      const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Unknown";
                      const isSelected = selectedId === cl.id;
                      const canCertifyCheck = cl.email_drafts?.status === "draft";
                      const canSendCheck = sendReadyLeads.some((s) => s.id === cl.id);
                      const showCheckbox = canCertifyCheck || canSendCheck;
                      return (
                        <tr
                          key={cl.id}
                          onClick={() => setSelectedId(isSelected ? null : cl.id)}
                          className={cn(
                            "border-b border-border/40 cursor-pointer transition-colors",
                            isSelected ? "bg-primary/10" : "hover:bg-muted/40",
                          )}
                        >
                          <td className="w-10 px-3 py-3">
                            {showCheckbox ? (
                              <span
                                role="checkbox"
                                aria-checked={checkedIds.has(cl.id)}
                                onClick={(e) => toggleCheck(cl.id, e)}
                                className={cn(
                                  "size-4 rounded border flex items-center justify-center shrink-0 transition-colors cursor-pointer",
                                  checkedIds.has(cl.id) ? "bg-primary border-primary" : "border-border hover:border-muted-foreground",
                                )}
                              >
                                {checkedIds.has(cl.id) && <Check className="size-2.5 text-primary-foreground" />}
                              </span>
                            ) : (
                              <span className="size-4 block" />
                            )}
                          </td>
                          <td className="w-10 px-2 py-3 text-xs text-muted-foreground tabular-nums">{index + 1}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <Avatar name={name} size="sm" />
                              <span className="font-medium truncate max-w-[140px]">{name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">
                            <span className="truncate block max-w-[160px]">{lead?.email}</span>
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">
                            <span className="truncate block max-w-[120px]">{lead?.title}</span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(() => {
                                const ds = cl.email_drafts?.status;
                                const crm = cl.crm_status;
                                const pills: { label: string; cls: string }[] = [];

                                // Draft pill
                                if (ds === "draft") {
                                  pills.push({ label: "Draft", cls: "bg-amber-500/15 text-amber-600 border border-amber-500/30" });
                                } else if (ds === "generating") {
                                  pills.push({ label: "Generating…", cls: "bg-blue-500/15 text-blue-500 border border-blue-500/30" });
                                } else if (ds === "failed") {
                                  pills.push({ label: "Failed", cls: "bg-red-500/15 text-red-500 border border-red-500/30" });
                                } else if (ds === "approved") {
                                  pills.push({ label: "Certified", cls: "bg-primary/15 text-primary border border-primary/30" });
                                }

                                // Sent pill
                                if (ds === "sent" || crm === "sent") {
                                  pills.push({ label: "Sent", cls: "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30" });
                                }

                                // Completed — sequence finished (sent or replied, no more follow-ups pending)
                                if (crm === "sent" || crm === "replied") {
                                  pills.push({ label: "Completed", cls: "bg-green-500/15 text-green-600 border border-green-500/30" });
                                }

                                // Reply received
                                if (crm === "replied") {
                                  pills.push({ label: "Reply received", cls: "bg-primary/15 text-primary border border-primary/30" });
                                }

                                // Fallback if nothing matched
                                if (pills.length === 0) {
                                  pills.push({ label: "Pending", cls: "bg-muted text-muted-foreground border border-border" });
                                }

                                return pills.map(({ label, cls }) => (
                                  <span key={label} className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap", cls)}>
                                    {label}
                                  </span>
                                ));
                              })()}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">
                            <span className="truncate block max-w-[120px]">{lead?.company_name}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
          </div>

        </div>

        {/* Transparent click-catcher — no dimming; drawer overlays search/tabs/table as-is */}
        <div
          className={cn(
            "fixed inset-0 z-40 bg-transparent transition-opacity duration-200",
            leadPanelOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
          )}
          onClick={() => setSelectedId(null)}
          aria-hidden={!leadPanelOpen}
        />

        {/* Drawer — same as LeadDrawer */}
        <div
          className={cn(
            "fixed top-0 right-0 z-50 h-full w-[520px] max-w-[95vw] bg-card border-l border-border shadow-2xl",
            "flex flex-col overflow-hidden transition-transform duration-300 ease-in-out",
            leadPanelOpen ? "translate-x-0" : "translate-x-full pointer-events-none",
          )}
        >
            {panel && (
              <>
                {/* Panel header */}
                <div className="shrink-0 border-b border-border px-6 py-3 bg-background">
                  <div className="flex items-center justify-end mb-2">
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  {/* Lead name card */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (!selectedLead) return;
                      setDrawerLead({
                        id: panel.lead_id,
                        firstName: selectedLead.first_name ?? "",
                        lastName: selectedLead.last_name ?? "",
                        email: selectedLead.email ?? "",
                        company: "", domain: "", phone: "",
                        jobTitle: selectedLead.title ?? "",
                        country: selectedLead.country ?? "",
                        status: "Enriched", score: "—", source: "Apollo",
                        campaign: "", campaigns: [], createdAt: panel.created_at,
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
                          label={getDisplayStatus(panel)}
                          styleClass={getStatusStyle(panel)}
                          helpText={
                            panel.email_drafts?.status
                              ? (CAMPAIGN_STATUS_HELP[panel.email_drafts.status] ?? CAMPAIGN_STATUS_HELP.none)
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

                {/* Scrollable draft content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-4">
                    {panel.email_drafts?.status === "generating" || regenerating ? (
                      <div className="flex flex-col items-center py-20 gap-3 rounded-lg border border-border bg-card">
                        <Loader2 className="size-6 text-muted-foreground animate-spin" />
                        <p className="text-sm text-muted-foreground">Generating personalised email…</p>
                      </div>
                    ) : panel.email_drafts ? (
                      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Subject</Label>
                          <Input
                            value={editSubject}
                            onChange={(e) => setEditSubject(e.target.value)}
                            disabled={isPreviewingHistory || panel.email_drafts.status === "approved" || panel.email_drafts.status === "sent"}
                            className="font-medium text-base"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Body</Label>
                          <RichTextEditor
                            value={editBody}
                            onChange={setEditBody}
                            disabled={isPreviewingHistory || panel.email_drafts.status === "approved" || panel.email_drafts.status === "sent"}
                            minHeight={520}
                          />
                        </div>

                        <div className="flex flex-wrap gap-2 pt-2">
                          {panel.email_drafts.status === "draft" && !isPreviewingHistory && (
                            <>
                              <Button variant="outline" className="gap-1.5" disabled={saving} onClick={handleSaveEdit}>
                                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                                Save edits
                              </Button>
                              <Button className="gap-1.5" disabled={certifying} onClick={() => handleCertifyOne(panel.email_drafts!.id)}>
                                {certifying ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                                Certify draft
                              </Button>
                            </>
                          )}
                          {panel.email_drafts.status === "approved" && !isPreviewingHistory && (
                            <>
                              <p className="text-sm text-green-400 flex items-center gap-1.5">
                                <CheckCircle2 className="size-4" /> Certified — ready to send
                              </p>
                              <Button variant="outline" className="gap-1.5" disabled={certifying} onClick={handleReopen}>
                                <RotateCcw className="size-3.5" /> Reopen for editing
                              </Button>
                            </>
                          )}
                          {["draft", "failed", "rejected"].includes(panel.email_drafts.status) && !isPreviewingHistory && (
                            <Button variant="outline" className="gap-1.5" onClick={() => setRegenOpen((o) => !o)}>
                              <RotateCcw className="size-3.5" /> Regenerate
                            </Button>
                          )}
                          {["draft", "failed", "rejected"].includes(panel.email_drafts.status) && !isPreviewingHistory && promptChangedSinceDraft && (
                            <Button
                              variant="outline"
                              className="gap-1.5 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                              disabled={regenerating}
                              onClick={async () => {
                                setRegenerating(true); setError("");
                                try {
                                  const { data: { session } } = await supabase.auth.getSession();
                                  if (!session || !panel?.email_drafts?.id) return;
                                  const { draft } = await regenerateDraft(session.access_token, panel.email_drafts.id);
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
                                    (previewVersionId === v.id || (!previewVersionId && v.id === panel.email_drafts?.id))
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
                                  setEditSubject(panel.email_drafts?.subject ?? "");
                                  setEditBody(panel.email_drafts?.body ?? "");
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

                          {panel.attachment?.effective ? (
                            <div className="flex items-center justify-between rounded-lg border border-border bg-background p-2.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="size-4 text-muted-foreground shrink-0" />
                                <span className="text-sm truncate">{panel.attachment.effective.name}</span>
                                {panel.attachment.effective.size != null && (
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    ({panel.attachment.effective.size >= 1024 * 1024
                                      ? (panel.attachment.effective.size / 1024 / 1024).toFixed(1) + " MB"
                                      : Math.round(panel.attachment.effective.size / 1024) + " KB"})
                                  </span>
                                )}
                                <span className={cn(
                                  "ml-1 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                  panel.attachment.effective.source === "lead"
                                    ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                                    : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                                )}>
                                  {panel.attachment.effective.source === "lead" ? "This lead only" : "Campaign default"}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {panel.attachment.effective.url && (
                                  <button type="button"
                                          onClick={() => window.open(panel.attachment!.effective!.url!, "_blank")}
                                          className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/40 hover:border-blue-400/60 rounded-md px-2.5 py-1 transition-colors">
                                    View
                                  </button>
                                )}
                                <button type="button" onClick={() => leadFileRef.current?.click()}
                                        className="text-xs text-muted-foreground hover:text-foreground border border-border hover:border-border/80 rounded-md px-2.5 py-1 transition-colors">
                                  Change
                                </button>
                                {panel.attachment.perLead && (
                                  <button type="button" onClick={async () => {
                                    const { data: { session } } = await supabase.auth.getSession();
                                    if (!session) return;
                                    await removeCampaignLeadAttachment(session.access_token, panel.id);
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
                                     await uploadCampaignLeadAttachment(session.access_token, panel.id, file);
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
                            {panel.attachment?.perLead ? "Replace file for this lead" : "Use a different file for this lead"}
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
        </>
      )}

      {/* ── Kanban ────────────────────────────────────────────────────────── */}

      {/* ── Drafts ────────────────────────────────────────────────────────── */}
      {viewTab === "drafts" && (
        <div className="flex flex-1 min-h-0">
          {/* Left: lead list */}
          <div className="w-64 shrink-0 border-r border-border bg-card flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border shrink-0 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Leads · {campaignLeads.length}
              </p>
              {(() => {
                const draftLeads = campaignLeads.filter((cl) => cl.email_drafts?.status === "draft");
                const allSelected = draftLeads.length > 0 && draftLeads.every((cl) => checkedIds.has(cl.id));
                if (draftLeads.length === 0) return null;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      if (allSelected) {
                        setCheckedIds(new Set());
                      } else {
                        setCheckedIds(new Set(draftLeads.map((cl) => cl.id)));
                      }
                    }}
                    className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
                  >
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                );
              })()}
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-border/40">
              {campaignLeads.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">No leads yet.</p>
              ) : campaignLeads.map((cl) => {
                const lead = cl.leads;
                const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Unknown";
                const status = cl.email_drafts?.status ?? "none";
                const isActive = selectedId === cl.id;
                const isChecked = checkedIds.has(cl.id);
                const statusConfig: Record<string, { label: string; cls: string }> = {
                  generating: { label: "Generating", cls: "bg-yellow-500/15 text-yellow-500 border-yellow-500/25" },
                  draft:      { label: "Draft",       cls: "bg-primary/15 text-primary border-primary/25" },
                  approved:   { label: "Certified",   cls: "bg-green-500/15 text-green-500 border-green-500/25" },
                  sent:       { label: "Sent",        cls: "bg-muted text-muted-foreground border-border" },
                  failed:     { label: "Failed",      cls: "bg-destructive/15 text-destructive border-destructive/25" },
                  none:       { label: "No draft",    cls: "bg-muted text-muted-foreground border-border" },
                };
                const sc = statusConfig[status] ?? statusConfig.none;
                const isDraft = status === "draft";
                const showCheckbox = status !== "sent";
                const canCheck = showCheckbox;
                return (
                  <div
                    key={cl.id}
                    className={cn(
                      "flex items-center cursor-pointer border-l-2 transition-colors",
                      isActive ? "bg-primary/10 border-primary" : "border-transparent hover:bg-secondary/40",
                    )}
                    onClick={() => setSelectedId(cl.id)}
                  >
                    <div
                      className="w-9 shrink-0 py-3 pl-4 flex items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canCheck || !showCheckbox) return;
                        setCheckedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(cl.id)) next.delete(cl.id); else next.add(cl.id);
                          return next;
                        });
                      }}
                    >
                      {showCheckbox ? (
                        <span
                          role="checkbox"
                          aria-checked={isChecked}
                          aria-disabled={!canCheck}
                          className={cn(
                            "flex size-4 rounded items-center justify-center transition-colors shrink-0",
                            !canCheck && "cursor-not-allowed opacity-40",
                            canCheck && "cursor-pointer",
                            isChecked && canCheck
                              ? "bg-primary ring-2 ring-primary"
                              : "bg-transparent ring-2 ring-muted-foreground/70",
                          )}
                        >
                          {isChecked && canCheck && <Check className="size-2.5 text-primary-foreground" />}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0 py-3 pl-3
                     pr-3">
                      <Avatar name={name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-xs font-medium truncate", isActive ? "text-primary" : "text-foreground")}>{name}</p>
                        <span className={cn("mt-0.5 inline-flex px-1.5 py-0.5 rounded border text-[10px] font-semibold", sc.cls)}>
                          {sc.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: draft viewer/editor */}
          <div className="flex-1 overflow-y-auto">
            {!selected ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Select a lead to view their draft
              </div>
            ) : (
              <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">
                {/* Lead header */}
                <div className="flex items-center gap-3 pb-2 border-b border-border">
                  <Avatar name={[selected.leads?.first_name, selected.leads?.last_name].filter(Boolean).join(" ") || "?"} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{[selected.leads?.first_name, selected.leads?.last_name].filter(Boolean).join(" ") || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">{selected.leads?.email}</p>
                  </div>
                  {selected.email_drafts && (
                    <DraftStatusBadge
                      label={getDisplayStatus(selected)}
                      styleClass={getStatusStyle(selected)}
                    />
                  )}
                </div>

                {selected.email_drafts?.status === "generating" || regenerating ? (
                  <div className="flex flex-col items-center py-20 gap-3 rounded-lg border border-border bg-card">
                    <Loader2 className="size-6 text-muted-foreground animate-spin" />
                    <p className="text-sm text-muted-foreground">Generating personalised email…</p>
                  </div>
                ) : selected.email_drafts ? (
                  <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Subject</Label>
                      <Input
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        disabled={isPreviewingHistory || selected.email_drafts.status === "approved" || selected.email_drafts.status === "sent"}
                        className="font-medium"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Body</Label>
                      <RichTextEditor
                        value={editBody}
                        onChange={setEditBody}
                        disabled={isPreviewingHistory || selected.email_drafts.status === "approved" || selected.email_drafts.status === "sent"}
                        minHeight={360}
                      />
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selected.email_drafts.status === "draft" && !isPreviewingHistory && (
                        <>
                          <Button variant="outline" className="gap-1.5" disabled={saving} onClick={handleSaveEdit}>
                            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                            Save edits
                          </Button>
                          <Button className="gap-1.5" disabled={certifying} onClick={() => handleCertifyOne(selected.email_drafts!.id)}>
                            {certifying ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                            Certify
                          </Button>
                        </>
                      )}
                      {selected.email_drafts.status === "approved" && !isPreviewingHistory && (
                        <>
                          <p className="text-sm text-green-400 flex items-center gap-1.5 mr-1">
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
                        <Button variant="outline" className="gap-1.5" onClick={() => setHistoryOpen((o) => !o)}>
                          <History className="size-3.5" />
                          Version history
                          <ChevronDown className={cn("size-3.5 transition-transform", historyOpen && "rotate-180")} />
                        </Button>
                      )}
                    </div>

                    {/* Version history */}
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

                    {/* Regenerate panel */}
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
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-card p-12 text-center">
                    <p className="text-sm text-muted-foreground">No draft available for this lead.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sequences ─────────────────────────────────────────────────────── */}
      {viewTab === "sequences" && (
        <div className="flex flex-1 min-h-0">
          {/* Left panel: step list */}
          <div className="w-72 shrink-0 border-r border-border flex flex-col overflow-y-auto p-4 gap-2">
            {sequencesLoading ? (
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="border border-border rounded-lg p-4 space-y-2">
                    <div className="h-3 w-16 bg-secondary rounded" />
                    <div className="h-3 w-32 bg-secondary/60 rounded" />
                  </div>
                ))}
              </div>
            ) : seqFollowUpSteps.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No follow-up steps configured. Add them in Options.</p>
            ) : (
              seqFollowUpSteps.map((s) => {
                const isActive = selectedSequenceStep === s.step_order;
                const prevStep = campaignSteps.find((p) => p.step_order === s.step_order - 1);
                const subtitle = sequenceStepSubtitle(s, campaignLeads);
                const displayStep = sequenceDisplayStep(s.step_order);
                return (
                  <button
                    key={s.step_order}
                    type="button"
                    onClick={() => setSelectedSequenceStep(s.step_order)}
                    className={cn(
                      "border rounded-lg p-4 text-left cursor-pointer transition-all w-full",
                      isActive
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/40 hover:bg-muted/40",
                    )}
                  >
                    <p className="text-sm font-semibold text-foreground mb-0.5">
                      Step {displayStep}
                    </p>
                    {subtitle && (
                      <p className="text-xs text-muted-foreground truncate mb-1">{subtitle}</p>
                    )}
                    {prevStep && prevStep.delay > 0 && (
                      <p className="text-[11px] text-muted-foreground/70">
                        Send {prevStep.delay} {prevStep.delay_unit} after previous
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Right panel: editable step email */}
          <div className="flex-1 overflow-y-auto p-6">
            {!activeSeqStep ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Select a step to preview
              </div>
            ) : (
              <div className="max-w-2xl mx-auto space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      Step {sequenceDisplayStep(activeSeqStep.step_order)}
                    </span>
                    {(() => {
                      const prev = campaignSteps.find((p) => p.step_order === activeSeqStep.step_order - 1);
                      return prev && prev.delay > 0 ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          Sends {prev.delay} {prev.delay_unit} after previous
                        </span>
                      ) : null;
                    })()}
                  </div>
                  {seqHasContent && (
                    <button
                      type="button"
                      disabled={seqStepSaving}
                      onClick={() => void handleSaveSeqDraft()}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
                    >
                      {seqStepSaving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                      Save
                    </button>
                  )}
                </div>

                {seqHasContent ? (
                  <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Subject</Label>
                      <Input
                        value={seqSubjectEdit}
                        onChange={(e) => setSeqSubjectEdit(e.target.value)}
                        placeholder="No subject (threaded reply)"
                        className="text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Body</Label>
                      <RichTextEditor
                        value={seqBodyEdit}
                        onChange={setSeqBodyEdit}
                        minHeight={280}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card p-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      {`No template set for step ${sequenceDisplayStep(activeSeqStep.step_order)}.`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Options ───────────────────────────────────────────────────────── */}
      {viewTab === "options" && (
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-2xl mx-auto">
            <EditCampaignForm
              campaign={campaign}
              onSaved={() => {
                if (appSession?.access_token) void loadCampaigns(appSession.access_token);
              }}
            />
          </div>
        </div>
      )}

      {/* ── Replies ───────────────────────────────────────────────────────── */}
      {viewTab === "replies" && (
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
                  disabled={syncingReplies}
                  onClick={async () => {
                    const now = Date.now();
                    syncHitTimesRef.current = syncHitTimesRef.current.filter(
                      (t) => now - t < SYNC_RATE_WINDOW_MS,
                    );
                    if (syncHitTimesRef.current.length >= SYNC_RATE_LIMIT) {
                      toast.warning("Please wait a few seconds before trying again.");
                      return;
                    }
                    syncHitTimesRef.current.push(now);

                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session) return;
                    setSyncingReplies(true);
                    try {
                      const result = await syncCampaignReplies(session.access_token, campaign.id);
                      await loadReplies();
                      if (result.backfilled > 0) {
                        toast.success(`Synced ${result.backfilled} missed repl${result.backfilled === 1 ? "y" : "ies"} from Instantly`);
                      } else {
                        toast.success("Replies are up to date");
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

                {/* Original outbound email — RIGHT bubble */}
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

                      {/* AI Reply draft — RIGHT bubble */}
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
      )}

      {/* ── Shared modals ─────────────────────────────────────────────────── */}

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
