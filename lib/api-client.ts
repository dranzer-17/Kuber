"use client";

import type { Lead, LeadStatus, LeadScore, LeadSource, EnrichmentStage } from "@/lib/leads";
import type { Campaign } from "@/components/app/create-campaign-modal";
import type { CampaignStepInput } from "@/lib/constants";

// ─── Token helper ─────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { supabase } = await import("@/lib/supabase");
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
  if (!json.success) {
    // A previously-valid session can go stale mid-use (e.g. the account was
    // just deactivated) — force the user out instead of leaving them staring
    // at a broken page full of failed requests.
    if (res.status === 401) {
      const { supabase } = await import("@/lib/supabase");
      await supabase.auth.signOut();
      if (typeof window !== "undefined") window.location.href = "/";
    }
    const err = new Error(json.error?.message ?? `API error ${res.status}`) as Error & { code?: string; details?: unknown };
    err.code = json.error?.code;
    err.details = json.error?.details;
    throw err;
  }
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
  assigned_to: string | null;
  imports: { id: string; label: string; color: string } | null;
  campaign_name?: string | null;
  campaign_list?: { id: string; name: string; crm_status: string }[];
  // Set only by the single-lead GET route (review §3.4) — see lib/mappers.ts.
  org_shared?: { other_lead_count: number; other_owner_count: number } | null;
  organizations: {
    id: string;
    name: string;
    domain: string | null;
    domain_source: string | null;
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
  // followup_day_2 / followup_day_3 are kept as nullable columns in the DB but
  // no longer written on creation — step delays now live in campaign_steps rows.
  followup_day_2: number | null;
  followup_day_3: number | null;
  created_by: string;
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
    domainSource: (org?.domain_source as Lead["domainSource"]) ?? null,
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
    assignedTo: l.assigned_to ?? null,
    orgShared: l.org_shared
      ? { otherLeadCount: l.org_shared.other_lead_count, otherOwnerCount: l.org_shared.other_owner_count }
      : null,
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
    createdBy: c.created_by,
  };
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function fetchLeadsCount(token: string): Promise<number> {
  const data = await apiFetch<{ total: number }>("/api/v1/leads/count", {}, token);
  return data.total;
}

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

export type ServiceIssue = { service: string; kind: "credits" | "auth"; message: string };

export async function fetchServiceHealth(token: string): Promise<ServiceIssue[]> {
  const data = await apiFetch<{ issues: ServiceIssue[] }>(`/api/v1/service-health`, {}, token);
  return data.issues;
}

export type LeadActivityEvent = { event: string; detail: string | null; actor_name: string | null; created_at: string };

export async function fetchLeadActivity(token: string, id: string): Promise<LeadActivityEvent[]> {
  const data = await apiFetch<{ events: LeadActivityEvent[] }>(`/api/v1/leads/${id}/activity`, {}, token);
  return data.events;
}

export async function patchLead(token: string, id: string, body: {
  first_name?: string; last_name?: string; email?: string; phone?: string;
  title?: string; headline?: string; linkedin_url?: string;
  city?: string; state?: string; country?: string; email_status?: string;
  // Manager-only single-lead reassignment; null returns the lead to the pool.
  assigned_to?: string | null;
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

export type BulkAssignStrategy = "manual" | "round_robin" | "territory";

// Mirror of the server AssignmentSummary (spec §3/§4).
export type AssignmentSummary = {
  total: number;
  newly_assigned: number;
  reassigned: number;
  skipped_already_assigned: number;
  skipped_not_ready: number;
  unmatched: number;
  eligible_employee_count: number;
  excluded_offline: number;
  excluded_deactivated: number;
  manual_target_offline: boolean;
};

export async function bulkAssignLeads(
  token: string,
  ids: string[],
  strategy: BulkAssignStrategy,
  assignedTo?: string | null,
  skipAlreadyAssigned = false,
): Promise<AssignmentSummary> {
  const body = strategy === "manual"
    ? { strategy, ids, assigned_to: assignedTo ?? null, skip_already_assigned: skipAlreadyAssigned }
    : { strategy, ids, skip_already_assigned: skipAlreadyAssigned };
  return apiFetch("/api/v1/leads/bulk-assign", { method: "POST", body: JSON.stringify(body) }, token);
}

export async function deleteCampaign(token: string, id: string): Promise<{ deleted: string }> {
  return apiFetch(`/api/v1/campaigns/${id}`, { method: "DELETE" }, token);
}

export async function pauseCampaign(token: string, id: string): Promise<{ paused: number; errors: string[] }> {
  return apiFetch(`/api/v1/campaigns/${id}/pause`, { method: "POST" }, token);
}

export async function resumeCampaign(token: string, id: string): Promise<{ resumed: number; errors: string[] }> {
  return apiFetch(`/api/v1/campaigns/${id}/resume`, { method: "POST" }, token);
}

/** Assign a whole campaign to one employee (null returns it to the pool). */
export async function assignCampaign(
  token: string,
  id: string,
  assignedTo: string | null,
  reassignLeads: boolean,
): Promise<{ campaign_id: string; assigned_to: string | null; previous_assignee: string | null; changed: boolean; leads_reassigned: number }> {
  return apiFetch(`/api/v1/campaigns/${id}/assign`, {
    method: "POST",
    body: JSON.stringify({ assigned_to: assignedTo, reassign_leads: reassignLeads }),
  }, token);
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

/** Requeues every org that failed enrichment but still has retry attempts left. */
export async function retryAllFailedEnrichment(token: string): Promise<{ requeued: number }> {
  return apiFetch(`/api/enrich/retry-all`, { method: "POST" }, token);
}

export async function createLead(token: string, body: {
  email: string; first_name?: string; last_name?: string;
  organization_name: string; organization_domain?: string;
  organization_industry?: string; organization_country?: string;
  title?: string; country?: string;
  batch_name?: string; color?: string; import_id?: string;
  assigned_to?: string;
}): Promise<Lead & { import_id?: string | null }> {
  const data = await apiFetch<DbLead & { import_id?: string | null }>("/api/v1/leads", { method: "POST", body: JSON.stringify(body) }, token);
  return { ...mapDbLead(data), import_id: data.import_id };
}

// How an import distributes its leads: a manual target, a spread strategy, or
// neither (pool). The server treats them independently; callers set at most one.
export type ImportAssignment = {
  assigned_to?: string;
  assignment_strategy?: "round_robin" | "territory";
};

// A duplicate skipped on import, with who already owns it — so the importer
// isn't just told "skipped" with no idea the lead belongs to someone else
// (review §3.3). `assigned_to` is a profile id; resolve to a name client-side
// against an already-loaded employee list.
export type DuplicateOwner = { email?: string; name?: string; company?: string; assigned_to: string | null };

export async function importExcelDirect(
  token: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  batch_name: string,
  color = "violet",
  assignment: ImportAssignment = {},
): Promise<{
  inserted: number; skipped_blank_email: number; skipped_invalid_email: number;
  skipped_duplicate_in_file: number; skipped_duplicate_in_db: number;
  assignment_skipped?: number; duplicate_owners?: DuplicateOwner[];
}> {
  return apiFetch("/api/v1/leads/import-excel", {
    method: "POST",
    body: JSON.stringify({ mode: "direct", rows, mapping, batch_name, color, ...assignment }),
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
  assigned_to?: string; assignment_strategy?: "round_robin" | "territory";
}): Promise<{ inserted: number; skipped: number; orgs_created: number; assignment_skipped?: number; duplicate_owners?: DuplicateOwner[] }> {
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

export async function fetchDraftSiblings(token: string, draftId: string): Promise<{
  siblings: Array<{ id: string; step_number: number; subject: string | null; body: string | null; status: string; created_at: string }>;
}> {
  return apiFetch(`/api/v1/drafts/${draftId}/siblings`, {}, token);
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
  opts?: { campaignLeadIds?: string[] },
): Promise<{ buckets: number; sent: number }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/send`, {
    method: "POST",
    ...(opts?.campaignLeadIds?.length
      ? { body: JSON.stringify({ campaign_lead_ids: opts.campaignLeadIds }) }
      : {}),
  }, token);
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

// ─── Per-user settings (personal prompt / signature / sender / theme) ─────────

export type MySettings = {
  draft_prompt: string | null;
  reply_prompt: string | null;
  signature: string | null;
  sender_name: string | null;
  theme: string | null;
  theme_mode: string | null;
  defaults: {
    draft_prompt: string;
    reply_prompt: string;
    signature: string;
    sender_name: string;
  };
};

export async function fetchMySettings(token: string): Promise<MySettings> {
  return apiFetch("/api/v1/me/settings", {}, token);
}

/** null (or "") clears a field back to "inherit the company default". */
export async function patchMySettings(
  token: string,
  body: Partial<Record<"draft_prompt" | "reply_prompt" | "signature" | "sender_name" | "theme" | "theme_mode", string | null>>,
): Promise<MySettings> {
  return apiFetch("/api/v1/me/settings", { method: "PATCH", body: JSON.stringify(body) }, token);
}

// ─── Roles / users / assignment ───────────────────────────────────────────────

export type Territory = "india" | "foreign";
export type AvailabilityStatus = "online" | "offline";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "manager" | "employee";
  territory: Territory | null;
  is_active: boolean;
  availability_status: AvailabilityStatus;
  is_super_admin: boolean;
  created_at: string;
};

export async function fetchUsers(token: string): Promise<Profile[]> {
  return apiFetch("/api/v1/settings/users", {}, token);
}

export async function createUser(token: string, body: {
  email: string; password: string; full_name: string; role: "manager" | "employee"; territory?: Territory | null;
}): Promise<Profile> {
  return apiFetch("/api/v1/settings/users", { method: "POST", body: JSON.stringify(body) }, token);
}

export async function patchUser(token: string, id: string, body: Partial<{
  full_name: string; role: "manager" | "employee"; territory: Territory | null; is_active: boolean; availability_status: AvailabilityStatus; password: string; reassign_to: string;
}>): Promise<Profile> {
  return apiFetch(`/api/v1/settings/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token);
}

// Self-service availability (spec §2B) — mark yourself online/offline.
export async function fetchMyAvailability(token: string): Promise<{ availability_status: AvailabilityStatus }> {
  return apiFetch("/api/v1/me/availability", {}, token);
}

export async function setMyAvailability(token: string, availability_status: AvailabilityStatus): Promise<{ availability_status: AvailabilityStatus }> {
  return apiFetch("/api/v1/me/availability", { method: "PATCH", body: JSON.stringify({ availability_status }) }, token);
}

// Auto-assignment default for newly-enriched pool leads (manager-only).
export async function fetchAssignmentSettings(token: string): Promise<{ strategy: "manual" | "round_robin" | "territory" }> {
  return apiFetch("/api/v1/settings/assignment", {}, token);
}

export async function patchAssignmentSettings(
  token: string,
  strategy: "manual" | "round_robin" | "territory",
): Promise<{ strategy: string }> {
  return apiFetch("/api/v1/settings/assignment", { method: "PATCH", body: JSON.stringify({ strategy }) }, token);
}

export async function fetchOversight(token: string): Promise<{
  campaigns: Array<{ id: string; name: string; status: string; created_by: string; total_leads: number; sent_count: number; opened_count: number; replied_count: number; hot_count: number; created_at: string; owner: Profile | null }>;
  employees: Array<Profile & { assigned_lead_count: number; campaign_count: number }>;
}> {
  return apiFetch("/api/v1/dashboard/oversight", {}, token);
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

export async function fetchCampaignSteps(token: string, campaignId: string): Promise<{
  steps: Array<CampaignStepInput & { id: string }>;
}> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/steps`, {}, token);
}

export async function saveCampaignSteps(
  token: string,
  campaignId: string,
  steps: CampaignStepInput[],
): Promise<{ updated: boolean }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/steps`, { method: "PUT", body: JSON.stringify({ steps }) }, token);
}

export async function patchCampaignConfig(
  token: string,
  campaignId: string,
  patch: {
    name?: string;
    daily_limit?: number;
    window_from?: string;
    window_to?: string;
    send_days?: Record<string, boolean>;
    schedule_timezone?: string;
    sender_name?: string;
    ai_prompt_context?: string;
  },
): Promise<{ updated: boolean; sync_errors: string[] }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/config`, { method: "PATCH", body: JSON.stringify(patch) }, token);
}

// Isolated from the step-1 draft's regenerate/generation pipeline entirely —
// see app/api/v1/campaigns/[id]/followup-regenerate/route.ts.
export async function regenerateFollowUpDraft(
  token: string,
  campaignId: string,
  campaignLeadId: string,
  stepNumber: number,
  currentBody: string,
  instruction: string,
): Promise<{ draft: { id: string; subject: string | null; body: string | null; status: string } }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/followup-regenerate`, {
    method: "POST",
    body: JSON.stringify({
      campaign_lead_id: campaignLeadId,
      step_number: stepNumber,
      body: currentBody,
      instruction,
    }),
  }, token);
}

export async function regenerateFollowUpStepTemplate(
  token: string,
  campaignId: string,
  stepNumber: number,
  currentBody: string,
  instruction?: string,
): Promise<{ body: string }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/followup-step-regenerate`, {
    method: "POST",
    body: JSON.stringify({
      step_number: stepNumber,
      body: currentBody,
      instruction,
    }),
  }, token);
}

// Save for a follow-up: persist + approve + sync to Instantly in one action.
// Deliberately separate from editDraft/approveDraft (the step-1 draft's
// PATCH .../drafts/[id] flow), whose "edit" action requires a non-empty
// subject — follow-ups are always empty (they thread as a reply).
export async function saveFollowUpDraft(
  token: string,
  campaignId: string,
  campaignLeadId: string,
  stepNumber: number,
  subject: string,
  body: string,
): Promise<{
  draft: { id: string; subject: string | null; body: string | null; status: string };
  instantly_sync: { attempted: boolean; synced: boolean; error?: string };
}> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/followup-save`, {
    method: "POST",
    body: JSON.stringify({ campaign_lead_id: campaignLeadId, step_number: stepNumber, subject, body }),
  }, token);
}

export async function createCampaign(token: string, body: {
  name: string; human_in_loop: boolean;
  daily_limit?: number; window_from?: string; window_to?: string;
  schedule_timezone?: string; send_days?: Record<string, boolean>;
  send_mode?: "now" | "scheduled"; schedule_start_at?: string;
  ai_prompt_context?: string; sender_name?: string;
  followup_steps?: { delay: number; delay_unit: "minutes" | "hours" | "days" }[];
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
    email_drafts: { id: string; subject: string | null; body: string | null; status: string; step_number?: number | null } | null;
  }[];
  total: number;
}> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/leads?limit=200`, {}, token);
}

export async function addLeadsToCampaign(token: string, campaignId: string, leadIds: string[]): Promise<{
  added: string[]; not_found: string[]; blocked_unsubscribed: string[]; skipped_existing: string[];
  also_in_other_campaigns?: Array<{ lead_id: string; campaign_id: string; campaign_name: string }>;
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

export interface ThreadMessage {
  id: string;
  event_type: string;
  reply_body: string | null;
  received_at: string;
  reply_drafts: ReplyDraft[];
}

export interface CampaignReplyThread {
  thread_key: string;
  campaign_lead_id: string | null;
  lead_email: string;
  lead: { first_name: string | null; last_name: string | null; email: string | null; title: string | null } | null;
  latest_temperature: string | null;
  original_email: { subject: string | null; body: string | null } | null;
  latest_received_at: string;
  messages: ThreadMessage[];
}

export async function fetchCampaignReplies(token: string, campaignId: string): Promise<{ threads: CampaignReplyThread[] }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/replies`, {}, token);
}
export async function syncCampaignReplies(token: string, campaignId: string): Promise<{ found: number; backfilled: number }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/sync-replies`, { method: "POST" }, token);
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

// ─── Unibox ──────────────────────────────────────────────────────────────────

export type UniboxThreadSummary = {
  thread_id: string;
  lead_email: string | null;
  lead: { first_name: string | null; last_name: string | null; title: string | null; email: string | null } | null;
  campaign: { id: string; name: string } | null;
  eaccount: string | null;
  subject: string | null;
  preview: string | null;
  latest_at: string;
  latest_direction: string;
  unread_count: number;
  message_count: number;
  interest_status: number | null;
  lead_temperature: string | null;
  campaign_lead_id: string | null;
};

export type UniboxMessage = {
  id: string;
  instantly_email_id: string;
  direction: string;
  subject: string | null;
  from_email: string | null;
  to_emails: string | null;
  cc_emails: string | null;
  body_html: string | null;
  body_text: string | null;
  step: string | null;
  timestamp_email: string;
  is_unread: boolean;
  attachments: unknown;
  reply_event_id: string | null;
  // Who sent this, when known (review §4.2) — only set for replies sent
  // through our own reply endpoints, not messages synced from Instantly.
  sent_by: string | null;
  sent_by_name: string | null;
};

export async function fetchUniboxThreads(
  token: string,
  params: Record<string, string | undefined> = {},
): Promise<{ threads: UniboxThreadSummary[]; next_cursor: string | null; counts: { unread_total: number } }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const q = qs.toString();
  return apiFetch(`/api/v1/unibox/threads${q ? `?${q}` : ""}`, {}, token);
}

export async function fetchUniboxThread(token: string, threadId: string, hydrate = false): Promise<{
  thread_id: string;
  messages: UniboxMessage[];
  reply_drafts: ReplyDraft[];
  lead: Record<string, unknown> | null;
  campaign: { id: string; name: string } | null;
  reply_to_uuid: string | null;
  eaccount: string | null;
  campaign_lead_id: string | null;
  interest_status: number | null;
  lead_temperature: string | null;
}> {
  return apiFetch(`/api/v1/unibox/threads/${threadId}${hydrate ? "?hydrate=1" : ""}`, {}, token);
}

export async function sendUniboxReply(
  token: string,
  body: { thread_id: string; subject: string; body_html: string; body_text?: string; reply_draft_id?: string },
) {
  return apiFetch("/api/v1/unibox/reply", { method: "POST", body: JSON.stringify(body) }, token);
}

export async function setThreadStatus(token: string, threadId: string, interest_value: number | null, lead_email?: string) {
  return apiFetch(`/api/v1/unibox/threads/${threadId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ interest_value, lead_email }),
  }, token);
}

export async function markThreadRead(token: string, threadId: string) {
  return apiFetch(`/api/v1/unibox/threads/${threadId}/read`, { method: "POST" }, token);
}

export async function syncUnibox(token: string): Promise<{ ingested: number; pages: number }> {
  return apiFetch("/api/v1/unibox/sync", { method: "POST" }, token);
}

export async function fetchUniboxUnread(token: string) {
  return apiFetch<{ unread: number }>("/api/v1/unibox/unread-count", {}, token);
}
