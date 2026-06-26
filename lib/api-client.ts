"use client";

import type { Lead, LeadStatus, LeadScore, LeadSource, EnrichmentStage } from "@/lib/leads";
import type { Campaign } from "@/components/app/create-campaign-modal";

// ─── Token helper ─────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: true } }
  );
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

async function apiFetch<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const tok = token ?? await getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      ...init.headers,
    },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? `API error ${res.status}`);
  return json.data as T;
}

// ─── DB → frontend type mapping ───────────────────────────────────────────────

const LEAD_STATUS_MAP: Record<string, LeadStatus> = {
  new:            "New",
  enriching:      "Enriching",
  enriched:       "Enriched",
  input_required: "Input Required",
  open:           "Open",
  closed:         "Closed",
};

const SOURCE_MAP: Record<string, LeadSource> = {
  apollo: "Apollo",
  excel:  "Excel",
  manual: "Manual",
};

export interface DbLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  headline: string | null;
  country: string | null;
  lead_source: string;
  created_at: string;
  is_likely_to_engage: boolean | null;
  status: string;
  import_id: string | null;
  imports: { id: string; label: string; color: string } | null;
  campaign_name?: string | null;
  campaign_list?: { id: string; name: string; crm_status: string }[];
  organizations: {
    id: string;
    name: string;
    domain: string | null;
    unsubscribed: boolean;
    has_scraped: boolean;
    enrichment_stage: string | null;
    company_description: string | null;
    sells_to: string | null;
    last_error: string | null;
  } | null;
}

export interface DbCampaign {
  id: string;
  name: string;
  status: string;
  human_in_loop: boolean;
  total_leads: number;
  sent_count: number;
  replied_count: number;
  created_at: string;
  daily_limit: number | null;
  window_from: string | null;
  window_to: string | null;
  schedule_timezone: string | null;
  send_days: Record<string, boolean> | null;
  ai_prompt_context: string | null;
  sender_name: string | null;
  hot_count: number;
  cold_count: number;
}

export function mapDbLead(l: DbLead): Lead {
  const score: LeadScore = l.is_likely_to_engage === true ? "Hot" : l.is_likely_to_engage === false ? "Cold" : "—";
  const org = l.organizations;
  const enrichmentStage = (org?.enrichment_stage as EnrichmentStage) ?? null;

  const status: LeadStatus = LEAD_STATUS_MAP[l.status] ?? "New";
  const email = l.email ?? "";
  const domain = org?.domain ?? "";

  return {
    id: l.id,
    firstName: l.first_name ?? "",
    lastName: l.last_name ?? "",
    email,
    company: org?.name ?? "",
    domain,
    jobTitle: l.title ?? l.headline ?? "",
    phone: l.phone ?? "",
    country: l.country ?? "",
    status,
    score,
    source: SOURCE_MAP[l.lead_source] ?? "Manual",
    campaign: l.campaign_name ?? (l.campaign_list?.[0]?.name ?? ""),
    campaigns: l.campaign_list ?? [],
    createdAt: l.created_at,
    orgId: org?.id ?? null,
    enrichmentStage,
    companyDescription: org?.company_description ?? null,
    sellsTo: org?.sells_to ?? null,
    lastError: org?.last_error ?? null,
    hasScraped: org?.has_scraped ?? false,
    importId: l.import_id ?? null,
    batchLabel: l.imports?.label ?? null,
    batchColor: l.imports?.color ?? null,
  };
}

export function mapDbCampaign(c: DbCampaign): Campaign {
  const statusMap: Record<string, Campaign["status"]> = {
    draft: "Draft", processing: "Draft", active: "Live", paused: "Paused", completed: "Live", archived: "Paused",
  };
  return {
    id: c.id,
    name: c.name,
    status: statusMap[c.status] ?? "Draft",
    leads: c.total_leads,
    sent: c.sent_count,
    replied: c.replied_count,
    humanInLoop: c.human_in_loop,
    createdAt: c.created_at.slice(0, 10),
    dailyLimit: c.daily_limit ?? 30,
    windowFrom: c.window_from ?? "08:00",
    windowTo: c.window_to ?? "18:00",
    timezone: c.schedule_timezone ?? "Asia/Kolkata",
    sendDays: c.send_days ?? {},
    aiPromptContext: c.ai_prompt_context ?? undefined,
    senderName: c.sender_name ?? undefined,
    hot: c.hot_count ?? 0,
    cold: c.cold_count ?? 0,
  };
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function fetchLeads(token: string, params?: { limit?: number; page?: number; organization_id?: string }): Promise<{ leads: Lead[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.page) qs.set("page", String(params.page));
  if (params?.organization_id) qs.set("organization_id", params.organization_id);
  const data = await apiFetch<{ leads: DbLead[]; total: number }>(`/api/v1/leads?${qs}`, {}, token);
  return { leads: data.leads.map(mapDbLead), total: data.total };
}

export async function fetchLeadsByOrg(token: string, orgId: string): Promise<Lead[]> {
  const { leads } = await fetchLeads(token, { organization_id: orgId, limit: 200 });
  return leads;
}

export async function fetchLead(token: string, id: string): Promise<Lead> {
  const data = await apiFetch<DbLead>(`/api/v1/leads/${id}`, {}, token);
  return mapDbLead(data);
}

export async function patchLead(token: string, id: string, body: {
  first_name?: string; last_name?: string; email?: string; phone?: string;
  title?: string; headline?: string; linkedin_url?: string;
  city?: string; state?: string; country?: string; email_status?: string;
}): Promise<Lead> {
  const data = await apiFetch<DbLead>(`/api/v1/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token);
  return mapDbLead(data);
}

export async function deleteLead(token: string, id: string): Promise<{ deleted: string }> {
  return apiFetch(`/api/v1/leads/${id}`, { method: "DELETE" }, token);
}

export async function bulkDeleteLeads(token: string, ids: string[]): Promise<{ deleted: number }> {
  return apiFetch("/api/v1/leads/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) }, token);
}

export async function deleteCampaign(token: string, id: string): Promise<{ deleted: string }> {
  return apiFetch(`/api/v1/campaigns/${id}`, { method: "DELETE" }, token);
}

export async function fetchOrg(token: string, id: string): Promise<Record<string, unknown>> {
  return apiFetch(`/api/v1/organizations/${id}`, {}, token);
}

export async function patchOrg(token: string, id: string, body: {
  name?: string; domain?: string; website?: string; description?: string;
  industry?: string; city?: string; country?: string;
}): Promise<Record<string, unknown>> {
  return apiFetch(`/api/v1/organizations/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token);
}

export async function rescrapeOrg(token: string, orgId: string): Promise<{ id: string; queued_for_rescrape: boolean }> {
  return apiFetch(`/api/v1/organizations/${orgId}/rescrape`, { method: "POST" }, token);
}

export async function createLead(token: string, body: {
  email: string; first_name?: string; last_name?: string;
  organization_name: string; organization_domain?: string;
  organization_industry?: string; organization_country?: string;
  title?: string; country?: string;
  batch_name?: string; color?: string; import_id?: string;
}): Promise<Lead & { import_id?: string | null }> {
  const data = await apiFetch<DbLead & { import_id?: string | null }>("/api/v1/leads", { method: "POST", body: JSON.stringify(body) }, token);
  return { ...mapDbLead(data), import_id: data.import_id };
}

export async function importExcelDirect(token: string, rows: Record<string, string>[], mapping: Record<string, string>, batch_name: string, color = "violet"): Promise<{
  inserted: number; skipped_blank_email: number; skipped_invalid_email: number;
  skipped_duplicate_in_file: number; skipped_duplicate_in_db: number;
}> {
  return apiFetch("/api/v1/leads/import-excel", {
    method: "POST",
    body: JSON.stringify({ mode: "direct", rows, mapping, batch_name, color }),
  }, token);
}

export type PreviewLead = { firstName: string; lastName: string; email: string; company: string; jobTitle: string; domain?: string };

export async function apolloPreview(token: string, body: {
  keywords: string[]; locations: string[]; max_pages: number;
  titles?: string[]; seniorities?: string[]; batch_name: string; color?: string;
}): Promise<{ preview: true; leads: PreviewLead[] }> {
  return apiFetch("/api/v1/leads/apollo-search", {
    method: "POST",
    body: JSON.stringify({ ...body, preview: true }),
  }, token);
}

export async function apolloSearch(token: string, body: {
  keywords: string[]; locations: string[]; max_pages: number;
  titles?: string[]; seniorities?: string[]; batch_name: string; color?: string;
}): Promise<{ inserted: number; skipped: number; orgs_created: number }> {
  return apiFetch("/api/v1/leads/apollo-search", { method: "POST", body: JSON.stringify(body) }, token);
}

// ─── Drafts & campaign send ───────────────────────────────────────────────────

export async function triggerDraftGeneration(token: string, campaignId: string): Promise<{ queued: boolean; lead_count: number }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/generate-drafts`, { method: "POST" }, token);
}

export async function fetchDraftProgress(token: string, campaignId: string): Promise<{
  total: number; generating: number; draft: number; approved: number; sent: number; failed: number; pending: number;
}> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/draft-progress`, {}, token);
}

export async function approveDraft(token: string, draftId: string): Promise<{ id: string; status: string }> {
  return apiFetch(`/api/v1/drafts/${draftId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
  }, token);
}

export async function bulkApproveDrafts(token: string, draftIds: string[]): Promise<{ approved: number; skipped: number }> {
  return apiFetch("/api/v1/drafts/bulk-approve", {
    method: "POST",
    body: JSON.stringify({ draft_ids: draftIds }),
  }, token);
}

export async function editDraft(token: string, draftId: string, subject: string, body: string): Promise<{ id: string; status: string }> {
  return apiFetch(`/api/v1/drafts/${draftId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "edit", subject, body }),
  }, token);
}

export async function regenerateDraft(token: string, draftId: string, customInstruction?: string): Promise<{
  draft: { id: string; subject: string | null; body: string | null; status: string; version?: number };
}> {
  return apiFetch(`/api/v1/drafts/${draftId}/regenerate`, {
    method: "POST",
    body: JSON.stringify({ custom_instruction: customInstruction }),
  }, token);
}

export async function reopenDraft(token: string, draftId: string): Promise<{ id: string; status: string }> {
  return apiFetch(`/api/v1/drafts/${draftId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "reopen" }),
  }, token);
}

export async function fetchDraftHistory(token: string, draftId: string): Promise<{
  versions: Array<{ id: string; subject: string | null; body: string | null; status: string; version: number; created_at: string }>;
}> {
  return apiFetch(`/api/v1/drafts/${draftId}/history`, {}, token);
}

export async function restoreDraftVersion(token: string, draftId: string): Promise<{ id: string; status: string }> {
  return apiFetch(`/api/v1/drafts/${draftId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "restore" }),
  }, token);
}

export async function sendApprovedLeads(
  token: string,
  campaignId: string,
): Promise<{ buckets: number; sent: number }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/send`, { method: "POST" }, token);
}

export async function setCampaignLeadStatus(
  token: string,
  campaignId: string,
  campaignLeadId: string,
  crmStatus: "won" | "closed" | "replied" | "new" | "enriched" | "draft" | "approved" | "sent" | "failed" | "skipped",
): Promise<{ id: string; crm_status: string }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/leads`, {
    method: "PATCH",
    body: JSON.stringify({ campaign_lead_id: campaignLeadId, crm_status: crmStatus }),
  }, token);
}

export async function retryFailedDrafts(token: string, campaignId: string): Promise<{ retried: number; errors: string[] }> {
  const { campaign_leads } = await fetchCampaignLeads(token, campaignId);
  const failed = campaign_leads.filter((cl) => cl.email_drafts?.status === "failed" && cl.email_drafts?.id);
  const errors: string[] = [];
  let retried = 0;
  for (const cl of failed) {
    try {
      await regenerateDraft(token, cl.email_drafts!.id);
      retried++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { retried, errors };
}

export async function fetchCampaignReport(token: string, campaignId: string): Promise<{
  campaignId: string;
  totals: {
    leads: number;
    draftsGenerated: number;
    certified: number;
    sent: number;
    replied: number;
    failed: number;
  };
  rates: { replyRate: number; certifyRate: number };
  draftGeneration: {
    total: number;
    pending: number;
    generating: number;
    succeeded: number;
    failed: number;
    successRate: number;
  };
  stageDistribution: Array<{ stage: string; label: string; count: number }>;
}> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/report`, {}, token);
}

export async function fetchSettings(token: string): Promise<Record<string, string>> {
  return apiFetch("/api/v1/settings", {}, token);
}

export async function patchSettings(token: string, body: Record<string, string>): Promise<Record<string, string>> {
  return apiFetch("/api/v1/settings", { method: "PATCH", body: JSON.stringify(body) }, token);
}

export async function fetchLogo(token: string): Promise<{ logo_path: string | null; logo_url: string | null }> {
  return apiFetch("/api/v1/settings/logo", {}, token);
}

export async function uploadLogo(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/v1/settings/logo", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? "Upload failed");
  return json.data as {
    logo_path: string;
    logo_url: string | null;
    logo_name: string;
    logo_mime: string;
    logo_size: number;
  };
}

export async function removeLogo(token: string): Promise<{ cleared: boolean }> {
  const res = await fetch("/api/v1/settings/logo", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? "Remove failed");
  return json.data as { cleared: boolean };
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export async function fetchCampaigns(token: string): Promise<Campaign[]> {
  const data = await apiFetch<{ campaigns: DbCampaign[] }>("/api/v1/campaigns", {}, token);
  return data.campaigns.map(mapDbCampaign);
}

export async function createCampaign(token: string, body: {
  name: string; human_in_loop: boolean;
  daily_limit?: number; window_from?: string; window_to?: string;
  schedule_timezone?: string; send_days?: Record<string, boolean>;
  send_mode?: "now" | "scheduled"; schedule_start_at?: string;
  ai_prompt_context?: string; sender_name?: string;
  attachment_path?: string; attachment_name?: string;
  attachment_mime?: string; attachment_size?: number;
  attachment_url?: string | null;
}): Promise<DbCampaign> {
  return apiFetch<DbCampaign>("/api/v1/campaigns", { method: "POST", body: JSON.stringify(body) }, token);
}

export async function uploadCampaignAttachment(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/v1/campaigns/attachment", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? "Upload failed");
  return json.data as {
    attachment_path: string; attachment_name: string;
    attachment_mime: string; attachment_size: number; attachment_url: string | null;
  };
}

export async function fetchCampaignLeads(token: string, campaignId: string): Promise<{
  campaign_leads: {
    id: string; lead_id: string; crm_status: string; created_at: string;
    leads: { first_name: string | null; last_name: string | null; email: string | null; title: string | null; country: string | null } | null;
    email_drafts: { id: string; subject: string | null; body: string | null; status: string } | null;
  }[];
  total: number;
}> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/leads?limit=200`, {}, token);
}

export async function addLeadsToCampaign(token: string, campaignId: string, leadIds: string[]): Promise<{
  added: string[]; not_found: string[]; blocked_unsubscribed: string[]; skipped_existing: string[];
}> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/leads`, {
    method: "POST",
    body: JSON.stringify({ lead_ids: leadIds }),
  }, token);
}

// ─── Imports / Batches ────────────────────────────────────────────────────────

export interface ImportBatch {
  id: string;
  label: string;
  source: string;
  lead_count: number;
  color: string;
  created_at: string;
}

export async function fetchImports(token: string): Promise<{ imports: ImportBatch[] }> {
  return apiFetch("/api/v1/imports", {}, token);
}

// ─── Per-admin Signature ──────────────────────────────────────────────────────

export async function fetchMySignature(token: string): Promise<{ full_name: string; title: string; contact: string; email: string }> {
  return apiFetch("/api/v1/settings/signature", {}, token);
}

export async function saveMySignature(token: string, sig: { full_name: string; title: string; contact: string }): Promise<{ saved: boolean }> {
  return apiFetch("/api/v1/settings/signature", { method: "PUT", body: JSON.stringify(sig) }, token);
}

// ─── Per-lead Attachment Override ──────────────────────────────────────────────

export async function uploadCampaignLeadAttachment(
  token: string,
  campaignLeadId: string,
  file: File,
): Promise<{ attachment_name: string; attachment_size: number; attachment_mime: string; attachment_url: string | null }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/v1/campaign-leads/${campaignLeadId}/attachment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? "Upload failed");
  return json.data;
}

export async function removeCampaignLeadAttachment(
  token: string,
  campaignLeadId: string,
): Promise<{ cleared: boolean }> {
  return apiFetch(`/api/v1/campaign-leads/${campaignLeadId}/attachment`, { method: "DELETE" }, token);
}

// ─── Reply drafts ────────────────────────────────────────────────────────────

export interface ReplyDraft {
  id: string;
  reply_event_id: string;
  campaign_lead_id: string | null;
  campaign_id: string | null;
  subject: string | null;
  body: string | null;
  status: "generating" | "draft" | "approved" | "sent" | "failed" | "rejected";
  reply_to_uuid: string | null;
  eaccount: string | null;
  version: number;
  sent_at: string | null;
  error: string | null;
}

export interface CampaignReply {
  id: string;
  event_type: string;
  reply_body: string | null;
  intent_classified: string | null;
  received_at: string;
  lead_email: string | null;
  campaign_lead_id: string | null;
  campaign_leads: {
    id: string;
    lead_temperature: string | null;
    interest_status: number | null;
    crm_status: string;
    leads: { first_name: string | null; last_name: string | null; email: string | null; title: string | null } | null;
  } | null;
  reply_draft: ReplyDraft | null;
}

export async function fetchCampaignReplies(token: string, campaignId: string): Promise<{ replies: CampaignReply[] }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/replies`, {}, token);
}
export async function editReplyDraft(token: string, id: string, subject: string, body: string): Promise<ReplyDraft> {
  return apiFetch(`/api/v1/reply-drafts/${id}`, { method: "PATCH", body: JSON.stringify({ action: "edit", subject, body }) }, token);
}
export async function approveReplyDraft(token: string, id: string, subject?: string, body?: string): Promise<ReplyDraft> {
  return apiFetch(`/api/v1/reply-drafts/${id}`, { method: "PATCH", body: JSON.stringify({ action: "approve", subject, body }) }, token);
}
export async function rejectReplyDraft(token: string, id: string, reason?: string): Promise<ReplyDraft> {
  return apiFetch(`/api/v1/reply-drafts/${id}`, { method: "PATCH", body: JSON.stringify({ action: "reject", rejection_reason: reason }) }, token);
}
export async function sendReplyDraft(token: string, id: string): Promise<{ sent: boolean }> {
  return apiFetch(`/api/v1/reply-drafts/${id}/send`, { method: "POST" }, token);
}
export async function regenerateReplyDraft(token: string, id: string, instruction?: string): Promise<ReplyDraft> {
  return apiFetch(`/api/v1/reply-drafts/${id}/regenerate`, { method: "POST", body: JSON.stringify({ instruction }) }, token);
}
