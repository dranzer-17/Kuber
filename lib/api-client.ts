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

const CRM_STATUS_MAP: Record<string, LeadStatus> = {
  new:        "New",
  enriching:  "Enriching",
  enriched:   "Enriched",
  draft_ready: "Draft Ready",
  in_review:  "In Review",
  approved:   "Approved",
  sent:       "Sent",
  replied:    "Replied",
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
  crm_status: string;
  campaign_name?: string | null;
  campaign_list?: { id: string; name: string; crm_status: string }[];
  organizations: {
    id: string;
    name: string;
    domain: string | null;
    description: string | null;
    unsubscribed: boolean;
    has_scraped: boolean;
    primary_products: string[] | null;
    competitors: string[] | null;
    news_summary: string | null;
    intent_signals: string[] | null;
    // new enrichment fields
    enrichment_stage: string | null;
    company_description: string | null;
    sells_to: string | null;
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
  instantly_campaign_id: string | null;
  daily_limit: number | null;
  window_from: string | null;
  window_to: string | null;
  schedule_timezone: string | null;
  send_days: Record<string, boolean> | null;
}

export function mapDbLead(l: DbLead): Lead {
  const score: LeadScore = l.is_likely_to_engage === true ? "Hot" : l.is_likely_to_engage === false ? "Cold" : "—";
  const org = l.organizations;
  return {
    id: l.id,
    firstName: l.first_name ?? "",
    lastName: l.last_name ?? "",
    email: l.email ?? "",
    company: org?.name ?? "",
    domain: org?.domain ?? "",
    jobTitle: l.title ?? l.headline ?? "",
    phone: l.phone ?? "",
    country: l.country ?? "",
    status: (() => {
      // If lead has a campaign status beyond "new", honour it
      if (l.crm_status && l.crm_status !== "new") return CRM_STATUS_MAP[l.crm_status] ?? "New";
      // Otherwise derive from org enrichment stage
      const stage = org?.enrichment_stage;
      if (stage === "queued" || stage === "scraping") return "Enriching" as const;
      if (stage === "done") return "Enriched" as const;
      return "New" as const;
    })(),
    score,
    source: SOURCE_MAP[l.lead_source] ?? "Manual",
    campaign: l.campaign_name ?? (l.campaign_list?.[0]?.name ?? ""),
    campaigns: l.campaign_list ?? [],
    createdAt: l.created_at.slice(0, 10),
    orgId: org?.id ?? null,
    enrichmentStage: (org?.enrichment_stage as EnrichmentStage) ?? null,
    companyDescription: org?.company_description ?? org?.description ?? null,
    sellsTo: org?.sells_to ?? null,
    hasScraped: org?.has_scraped ?? false,
    primaryProducts: org?.primary_products ?? [],
    competitors: org?.competitors ?? [],
    newsSummary: org?.news_summary ?? null,
    intentSignals: org?.intent_signals ?? [],
  };
}

export function mapDbCampaign(c: DbCampaign): Campaign {
  const statusMap: Record<string, Campaign["status"]> = {
    draft: "Draft", active: "Live", paused: "Paused", completed: "Live", archived: "Paused",
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
    instantlyId: c.instantly_campaign_id ?? null,
    dailyLimit: c.daily_limit ?? 30,
    windowFrom: c.window_from ?? "08:00",
    windowTo: c.window_to ?? "18:00",
    timezone: c.schedule_timezone ?? "Asia/Kolkata",
    sendDays: c.send_days ?? {},
  };
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function fetchLeads(token: string, params?: { limit?: number; page?: number }): Promise<{ leads: Lead[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.page) qs.set("page", String(params.page));
  const data = await apiFetch<{ leads: DbLead[]; total: number }>(`/api/v1/leads?${qs}`, {}, token);
  return { leads: data.leads.map(mapDbLead), total: data.total };
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

export async function createLead(token: string, body: {
  email: string; first_name?: string; last_name?: string;
  organization_name: string; organization_domain?: string; title?: string; country?: string;
}): Promise<Lead> {
  const data = await apiFetch<DbLead>("/api/v1/leads", { method: "POST", body: JSON.stringify(body) }, token);
  return mapDbLead(data);
}

export async function importExcelDirect(token: string, rows: Record<string, string>[], mapping: Record<string, string>): Promise<{
  inserted: number; skipped_blank_email: number; skipped_invalid_email: number;
  skipped_duplicate_in_file: number; skipped_duplicate_in_db: number;
}> {
  return apiFetch("/api/v1/leads/import-excel", {
    method: "POST",
    body: JSON.stringify({ mode: "direct", rows, mapping }),
  }, token);
}

export async function apolloSearch(token: string, body: {
  keywords: string[]; locations: string[]; max_pages: number;
  titles?: string[]; seniorities?: string[];
}): Promise<{ inserted: number; skipped: number; orgs_created: number }> {
  return apiFetch("/api/v1/leads/apollo-search", { method: "POST", body: JSON.stringify(body) }, token);
}

// ─── Email generation ─────────────────────────────────────────────────────────

export async function generateEmails(token: string, body: {
  lead_ids: string[];
  campaign_name: string;
  custom_instruction?: string;
  single_lead_id?: string;
}): Promise<{ emails: { lead_id: string; subject: string; body: string }[] }> {
  return apiFetch("/api/v1/campaigns/generate-emails", { method: "POST", body: JSON.stringify(body) }, token);
}

export async function sendCampaign(token: string, campaignId: string, body: {
  emails: { lead_id: string; email: string; first_name: string; last_name: string; subject: string; body: string }[];
  config: {
    daily_limit: number;
    window_from: string;
    window_to: string;
    timezone: string;
    send_days?: Record<string, boolean>;
  };
}): Promise<{ instantly_campaign_id: string; activated: boolean }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/send`, { method: "POST", body: JSON.stringify(body) }, token);
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
}): Promise<DbCampaign> {
  return apiFetch<DbCampaign>("/api/v1/campaigns", { method: "POST", body: JSON.stringify(body) }, token);
}

export async function fetchCampaignLeads(token: string, campaignId: string): Promise<{
  campaign_leads: {
    id: string; crm_status: string; created_at: string;
    leads: { first_name: string | null; last_name: string | null; email: string | null; title: string | null; country: string | null } | null;
    email_drafts: { subject: string | null; body: string | null; status: string } | null;
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
