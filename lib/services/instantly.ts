import { toInstantlyTimezone } from "@/lib/instantly-timezones";
import { requireServiceSecret } from "@/lib/services/service-keys";

const BASE = "https://api.instantly.ai/api/v2";

// Async because the key now resolves through Settings > Keys (DB first,
// .env.local as the fallback tier) instead of being read straight off
// process.env at module scope.
async function h() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await requireServiceSecret("instantly", "Instantly")}`,
  };
}

/** Auth-only variant for the endpoints that must not send Content-Type
 *  (GETs and multipart uploads). */
async function authOnly() {
  return { Authorization: `Bearer ${await requireServiceSecret("instantly", "Instantly")}` };
}

async function iJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const d = data as { message?: string; error?: string };
    throw new Error(`Instantly ${res.status}: ${d.message ?? d.error ?? "request failed"}`);
  }
  return data as T;
}

// ─── Day conversion ───────────────────────────────────────────────────────────
// Our DB/UI stores named keys: { monday: true, ... }
// Instantly requires numeric string keys: { "1": true, ... }, "0" = Sunday
const DAY_NAME_TO_NUM: Record<string, string> = {
  sunday: "0", monday: "1", tuesday: "2", wednesday: "3",
  thursday: "4", friday: "5", saturday: "6",
};

export function toInstantlyDays(
  sendDays: Record<string, boolean> | null | undefined,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(sendDays ?? {})) {
    const num = DAY_NAME_TO_NUM[k.toLowerCase()] ?? (/^[0-6]$/.test(k) ? k : null);
    if (num !== null) out[num] = !!v;
  }
  // Default Mon-Fri if nothing resolved
  if (Object.keys(out).length === 0) {
    return { "1": true, "2": true, "3": true, "4": true, "5": true, "0": false, "6": false };
  }
  return out;
}

// ─── Variable builder ─────────────────────────────────────────────────────────
// Turns approved drafts (by step) into Instantly custom_variables.
// step 1 → customSubject / customBody
// step N>1 → customSubjectN / customBodyN
// HTML mode: \n → <br> (see §10 for the test you must run before production)
export function buildCustomVariables(
  drafts: Array<{ step_number: number; subject: string | null; body: string | null }>,
  senderName?: string | null,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const d of drafts) {
    const sfx = d.step_number === 1 ? "" : String(d.step_number);
    if (d.subject != null) vars[`customSubject${sfx}`] = d.subject;
    if (d.body != null)    vars[`customBody${sfx}`]    = d.body.replace(/\n/g, "<br>");
  }
  if (senderName) vars.senderName = senderName;
  return vars;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstantlyStep {
  subject: string;        // empty string on follow-ups = threaded
  body: string;
  delay: number;          // wait before NEXT step (not the current one)
  delayUnit?: "minutes" | "hours" | "days";
}

export interface InstantlyLeadInput {
  email: string;
  firstName: string;
  lastName: string;
  customVariables: Record<string, string>;
}

export interface BulkAddResult {
  status: string;
  total_sent: number;
  leads_uploaded: number;
  duplicated_leads?: number;
  duplicate_email_count?: number;
  invalid_email_count?: number;
  skipped_count?: number;
  created_leads?: Array<{ index: number; id: string; email: string }>;
}

// ─── Campaign CRUD ────────────────────────────────────────────────────────────

export async function createInstantlyCampaign(opts: {
  name: string;
  dailyLimit: number;
  windowFrom: string;   // "09:00"
  windowTo: string;     // "18:00"
  timezone: string;     // IANA only
  sendDays: Record<string, boolean>;
  steps: InstantlyStep[];
  emailList: string[];  // sending-account emails — MUST be non-empty or campaign never sends
}): Promise<string> {
  if (opts.emailList.length === 0) {
    throw new Error("createInstantlyCampaign: emailList is empty — campaign will never send");
  }
  const res = await fetch(`${BASE}/campaigns`, {
    method: "POST",
    headers: await h(),
    body: JSON.stringify({
      name: opts.name,
      campaign_schedule: {
        schedules: [{
          name: "Default",
          timing: { from: opts.windowFrom, to: opts.windowTo },
          days: toInstantlyDays(opts.sendDays),
          timezone: toInstantlyTimezone(opts.timezone),
        }],
      },
      daily_limit: opts.dailyLimit,
      email_list: opts.emailList,
      stop_on_reply: true,
      stop_on_auto_reply: false,
      sequences: [{
        steps: opts.steps.map((s) => ({
          type: "email" as const,
          delay: s.delay,
          ...(s.delayUnit ? { delay_unit: s.delayUnit } : {}),
          variants: [{ subject: s.subject, body: s.body }],
        })),
      }],
    }),
  });
  const data = await iJson<{ id: string }>(res);
  return data.id;
}

export async function patchInstantlyCampaignConfig(
  instantlyCampaignId: string,
  opts: {
    name?: string;
    dailyLimit?: number;
    windowFrom?: string;
    windowTo?: string;
    timezone?: string;
    sendDays?: Record<string, boolean>;
  },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.dailyLimit !== undefined) body.daily_limit = opts.dailyLimit;
  if (opts.windowFrom !== undefined || opts.windowTo !== undefined || opts.timezone !== undefined || opts.sendDays !== undefined) {
    body.campaign_schedule = {
      schedules: [{
        name: "Default",
        timing: { from: opts.windowFrom, to: opts.windowTo },
        days: opts.sendDays ? toInstantlyDays(opts.sendDays) : undefined,
        timezone: opts.timezone ? toInstantlyTimezone(opts.timezone) : undefined,
      }],
    };
  }
  const res = await fetch(`${BASE}/campaigns/${instantlyCampaignId}`, {
    method: "PATCH",
    headers: await h(),
    body: JSON.stringify(body),
  });
  await iJson<unknown>(res);
}

export async function patchInstantlySequences(
  instantlyCampaignId: string,
  steps: InstantlyStep[],
): Promise<void> {
  const res = await fetch(`${BASE}/campaigns/${instantlyCampaignId}`, {
    method: "PATCH",
    headers: await h(),
    body: JSON.stringify({
      sequences: [{
        steps: steps.map((s) => ({
          type: "email" as const,
          delay: s.delay,
          ...(s.delayUnit ? { delay_unit: s.delayUnit } : {}),
          variants: [{ subject: s.subject, body: s.body }],
        })),
      }],
    }),
  });
  await iJson<unknown>(res);
}

export async function activateInstantlyCampaign(instantlyCampaignId: string): Promise<void> {
  const res = await fetch(`${BASE}/campaigns/${instantlyCampaignId}/activate`, {
    method: "POST",
    // authOnly(): NO Content-Type — there is no body, and declaring JSON with
    // an empty body 400s
    headers: await authOnly(),
  });
  await iJson<unknown>(res);
}

export async function pauseInstantlyCampaign(instantlyCampaignId: string): Promise<void> {
  const res = await fetch(`${BASE}/campaigns/${instantlyCampaignId}/pause`, {
    method: "POST",
    // authOnly(): NO Content-Type
    headers: await authOnly(),
  });
  await iJson<unknown>(res);
}

/** Permanently delete a campaign from Instantly. 404 = already gone (idempotent). */
export async function deleteInstantlyCampaign(instantlyCampaignId: string): Promise<void> {
  const res = await fetch(`${BASE}/campaigns/${instantlyCampaignId}`, {
    method: "DELETE",
    headers: await authOnly(),
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(`Instantly delete ${res.status}: ${data.message ?? "failed"}`);
  }
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function addLeadsToInstantly(
  instantlyCampaignId: string,
  leads: InstantlyLeadInput[],
): Promise<BulkAddResult> {
  const res = await fetch(`${BASE}/leads/add`, {   // CORRECT endpoint (NOT /campaign-lead)
    method: "POST",
    headers: await h(),
    body: JSON.stringify({
      campaign_id: instantlyCampaignId,
      skip_if_in_workspace: false,
      leads: leads.map((l) => ({
        email: l.email,
        first_name: l.firstName,
        last_name: l.lastName,
        custom_variables: l.customVariables,   // CORRECT field (NOT variables)
      })),
    }),
  });
  return iJson<BulkAddResult>(res);
}

/**
 * Permanently remove a lead from Instantly — stops all scheduled follow-up
 * steps for that person. 404 = already gone (idempotent), so retrying a
 * partially-failed delete is safe.
 */
export async function deleteInstantlyLead(instantlyLeadId: string): Promise<void> {
  const res = await fetch(`${BASE}/leads/${instantlyLeadId}`, {
    method: "DELETE",
    headers: await authOnly(),
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(`Instantly lead delete ${res.status}: ${data.message ?? "failed"}`);
  }
}

// ─── Leads: post-add updates ──────────────────────────────────────────────────
// PATCH /leads/{id} — used to push updated custom_variables (e.g. a follow-up
// draft's customBodyN/customSubjectN) to a lead that was already added to a
// campaign. Without this, editing/approving a follow-up draft after the lead's
// initial send never reaches Instantly — custom_variables are otherwise only
// ever set once, at addLeadsToInstantly() time.
export async function updateInstantlyLeadVariables(
  instantlyLeadId: string,
  customVariables: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${BASE}/leads/${instantlyLeadId}`, {
    method: "PATCH",
    headers: await h(),
    body: JSON.stringify({ custom_variables: customVariables }),
  });
  await iJson<unknown>(res);
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function listInstantlyAccounts(): Promise<
  Array<{ email: string; status: number; daily_limit?: number }>
> {
  const res = await fetch(`${BASE}/accounts?limit=100`, { headers: await h() });
  const data = await iJson<{
    items?: Array<{ email: string; status: number; daily_limit?: number }>
  }>(res);
  return data.items ?? [];
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export async function createInstantlyWebhook(opts: {
  url: string;
  eventType: string;       // "all_events" | "reply_received" | ...
  campaign?: string;       // optional Instantly campaign UUID filter
  secret?: string;
}): Promise<string> {
  const res = await fetch(`${BASE}/webhooks`, {
    method: "POST",
    headers: await h(),
    body: JSON.stringify({
      target_hook_url: opts.url,
      event_type: opts.eventType,
      ...(opts.campaign ? { campaign: opts.campaign } : {}),
      ...(opts.secret ? { headers: { "X-Webhook-Secret": opts.secret } } : {}),
    }),
  });
  const data = await iJson<{ id: string }>(res);
  return data.id;
}

// ─── Reading inbound emails / threads (Unibox) ────────────────────────────────
// GET /emails list is rate-limited to 20 req/min. Use sparingly.

export interface InstantlyEmail {
  id: string;
  thread_id?: string | null;
  message_id?: string | null;
  subject?: string | null;
  from_address_email?: string | null;
  to_address_email_list?: string | null;
  cc_address_email_list?: string | null;
  bcc_address_email_list?: string | null;
  body?: { text?: string | null; html?: string | null } | null;
  ue_type: number;
  is_auto_reply?: boolean | number;
  is_unread?: boolean | number;
  is_focused?: boolean | number;
  campaign_id?: string | null;
  lead?: string | null;
  lead_id?: string | null;
  eaccount?: string | null;
  step?: string | number | null;
  i_status?: number | null;
  ai_interest_value?: number | null;
  content_preview?: string | null;
  attachment_json?: unknown;
  timestamp_email?: string | null;
  timestamp_created?: string | null;
}

export interface ListEmailsParams {
  limit?: number;
  starting_after?: string;
  min_timestamp_created?: string;
  max_timestamp_created?: string;
  sort_order?: "asc" | "desc";
  campaign_id?: string;
  eaccount?: string;
  search?: string;
}

export interface ListEmailsResult {
  items: InstantlyEmail[];
  next_starting_after?: string | null;
}

// Token bucket: max 18 GET /emails list calls per minute
let listEmailsTimestamps: number[] = [];
const LIST_EMAILS_MAX_PER_MIN = 18;

async function throttleListEmails(): Promise<void> {
  const now = Date.now();
  listEmailsTimestamps = listEmailsTimestamps.filter((t) => now - t < 60_000);
  if (listEmailsTimestamps.length >= LIST_EMAILS_MAX_PER_MIN) {
    const waitMs = 60_000 - (now - listEmailsTimestamps[0]) + 100;
    await new Promise((r) => setTimeout(r, waitMs));
    listEmailsTimestamps = listEmailsTimestamps.filter((t) => Date.now() - t < 60_000);
  }
  listEmailsTimestamps.push(Date.now());
}

async function fetchEmailsList(url: string, retries = 2): Promise<ListEmailsResult> {
  await throttleListEmails();
  const res = await fetch(url, { headers: await h() });
  if (res.status === 429 && retries > 0) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return fetchEmailsList(url, retries - 1);
  }
  const data = await iJson<{ items?: InstantlyEmail[]; next_starting_after?: string | null }>(res);
  return { items: data.items ?? [], next_starting_after: data.next_starting_after ?? null };
}

export async function listEmails(params: ListEmailsParams = {}): Promise<ListEmailsResult> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.starting_after) qs.set("starting_after", params.starting_after);
  if (params.min_timestamp_created) qs.set("min_timestamp_created", params.min_timestamp_created);
  if (params.max_timestamp_created) qs.set("max_timestamp_created", params.max_timestamp_created);
  if (params.sort_order) qs.set("sort_order", params.sort_order);
  if (params.campaign_id) qs.set("campaign_id", params.campaign_id);
  if (params.eaccount) qs.set("eaccount", params.eaccount);
  if (params.search) qs.set("search", params.search);
  const url = `${BASE}/emails?${qs.toString()}`;
  return fetchEmailsList(url);
}

export async function markInstantlyThreadAsRead(threadId: string): Promise<void> {
  const res = await fetch(`${BASE}/emails/threads/${encodeURIComponent(threadId)}/mark-as-read`, {
    method: "POST",
    headers: await authOnly(),
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(`Instantly mark-as-read ${res.status}: ${data.message ?? "failed"}`);
  }
}

export async function countInstantlyUnread(): Promise<number> {
  try {
    const res = await fetch(`${BASE}/emails/unread/count`, { headers: await h() });
    if (!res.ok) return 0;
    const data = await res.json() as { count?: number; unread_count?: number };
    return data.count ?? data.unread_count ?? 0;
  } catch {
    return 0;
  }
}

export async function getInstantlyEmail(emailId: string): Promise<InstantlyEmail> {
  const res = await fetch(`${BASE}/emails/${emailId}`, { headers: await h() });
  return iJson<InstantlyEmail>(res);
}

// Pull a whole conversation in chronological order (oldest first) for AI context.
export async function listThreadEmails(threadId: string): Promise<InstantlyEmail[]> {
  const url = `${BASE}/emails?search=${encodeURIComponent(`thread:${threadId}`)}&sort_order=asc&limit=20`;
  const res = await fetch(url, { headers: await h() });
  const data = await iJson<{ items?: InstantlyEmail[] }>(res);
  return data.items ?? [];
}

// List received emails (prospect replies) for a specific Instantly sub-campaign.
// The Instantly API ignores ue_type as a query filter, so we filter client-side.
// ue_type=2 = received from prospect. Excludes auto-replies.
export async function listInstantlyCampaignReplies(
  instantlyCampaignId: string,
  limit = 100,
): Promise<InstantlyEmail[]> {
  const params = new URLSearchParams({
    campaign_id: instantlyCampaignId,
    limit: String(limit),
    sort_order: "desc",
  });
  const res = await fetch(`${BASE}/emails?${params.toString()}`, { headers: await h() });
  const data = await iJson<{ items?: InstantlyEmail[] }>(res);
  return (data.items ?? []).filter((e) => e.ue_type === 2 && !e.is_auto_reply);
}

// Fetch a lead's interest/status from Instantly by campaign + email.
// Uses POST /api/v2/leads/list (the GET /leads endpoint does not support filtering).
export async function getInstantlyLeadStatus(
  instantlyCampaignId: string,
  leadEmail: string,
): Promise<{ interest_value?: number | null; pl_value?: number | null } | null> {
  try {
    const res = await fetch(`${BASE}/leads/list`, {
      method: "POST",
      headers: await h(),
      body: JSON.stringify({
        campaign_id: instantlyCampaignId,
        search: leadEmail,
        limit: 5,
      }),
    });
    if (!res.ok) return null;
    // The real field is lt_interest_status, not interest_value/pl_value (those
    // don't exist in this response at all — confirmed live, they were always
    // silently reading undefined). The campaign_id filter above is also not
    // reliable on its own: for a lead enrolled in several sub-campaigns it can
    // return sibling campaigns' rows too, so `campaign` is checked client-side
    // as well rather than trusting the first email match.
    const data = await res.json().catch(() => null) as {
      items?: Array<{ email?: string; campaign?: string; lt_interest_status?: number | null }>;
    } | null;
    const match = (data?.items ?? []).find(
      (l) => l.email?.toLowerCase() === leadEmail.toLowerCase() && l.campaign === instantlyCampaignId,
    );
    if (!match) return null;
    return { interest_value: match.lt_interest_status ?? null, pl_value: null };
  } catch {
    return null;
  }
}

// ─── Sending a threaded reply ─────────────────────────────────────────────────
// reply_to_uuid = the Instantly email id of the inbound message (== webhook email_id).
// eaccount = the sending mailbox that owns the thread (from the original send / the inbound email).

export async function replyToInstantlyEmail(opts: {
  replyToUuid: string;
  eaccount: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  cc?: string[];
  bcc?: string[];
}): Promise<InstantlyEmail> {
  const res = await fetch(`${BASE}/emails/reply`, {
    method: "POST",
    headers: await h(),
    body: JSON.stringify({
      reply_to_uuid: opts.replyToUuid,
      eaccount: opts.eaccount,
      subject: opts.subject,
      body: { html: opts.bodyHtml, ...(opts.bodyText ? { text: opts.bodyText } : {}) },
      ...(opts.cc?.length ? { cc_address_email_list: opts.cc } : {}),
      ...(opts.bcc?.length ? { bcc_address_email_list: opts.bcc } : {}),
    }),
  });
  return iJson<InstantlyEmail>(res);
}

// ─── Interest status (CRM sync back to Instantly) ─────────────────────────────
// Setting a value also stops the sequence for that lead. disable_auto_interest=true
// prevents Instantly's own AI from overwriting our verdict later.

export async function updateLeadInterestStatus(opts: {
  leadEmail: string;
  interestValue: number | null;
  disableAutoInterest?: boolean;
}): Promise<void> {
  const res = await fetch(`${BASE}/leads/update-interest-status`, {
    method: "POST",
    headers: await h(),
    body: JSON.stringify({
      lead_email: opts.leadEmail,
      interest_value: opts.interestValue,
      ...(opts.disableAutoInterest ? { disable_auto_interest: true } : {}),
    }),
  });
  await iJson<unknown>(res);
}
