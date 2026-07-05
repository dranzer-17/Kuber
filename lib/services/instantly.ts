import { toInstantlyTimezone } from "@/lib/instantly-timezones";

const BASE = "https://api.instantly.ai/api/v2";

function h() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}`,
  };
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
    headers: h(),
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
    dailyLimit?: number;
    windowFrom?: string;
    windowTo?: string;
    timezone?: string;
    sendDays?: Record<string, boolean>;
  },
): Promise<void> {
  const body: Record<string, unknown> = {};
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
    headers: h(),
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
    headers: h(),
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
    headers: {
      Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}`,
      // NO Content-Type — there is no body, and declaring JSON with an empty body 400s
    },
  });
  await iJson<unknown>(res);
}

export async function pauseInstantlyCampaign(instantlyCampaignId: string): Promise<void> {
  const res = await fetch(`${BASE}/campaigns/${instantlyCampaignId}/pause`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}`,
      // NO Content-Type
    },
  });
  await iJson<unknown>(res);
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function addLeadsToInstantly(
  instantlyCampaignId: string,
  leads: InstantlyLeadInput[],
): Promise<BulkAddResult> {
  const res = await fetch(`${BASE}/leads/add`, {   // CORRECT endpoint (NOT /campaign-lead)
    method: "POST",
    headers: h(),
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
    headers: h(),
    body: JSON.stringify({ custom_variables: customVariables }),
  });
  await iJson<unknown>(res);
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export async function listInstantlyAccounts(): Promise<
  Array<{ email: string; status: number; daily_limit?: number }>
> {
  const res = await fetch(`${BASE}/accounts?limit=100`, { headers: h() });
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
    headers: h(),
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
// GET /emails is rate-limited to 20 req/min. Use sparingly.

export interface InstantlyEmail {
  id: string;
  thread_id: string;
  subject: string | null;
  from_address_email: string | null;
  to_address_email_list: string | null;
  body: { text?: string | null; html?: string | null } | null;
  ue_type: number;        // 1=sent from campaign, 2=received, 3=sent manual, 4=scheduled
  is_auto_reply?: boolean;
  campaign_id?: string | null;
  timestamp_email?: string | null;
  eaccount?: string | null;
}

export async function getInstantlyEmail(emailId: string): Promise<InstantlyEmail> {
  const res = await fetch(`${BASE}/emails/${emailId}`, { headers: h() });
  return iJson<InstantlyEmail>(res);
}

// Pull a whole conversation in chronological order (oldest first) for AI context.
export async function listThreadEmails(threadId: string): Promise<InstantlyEmail[]> {
  const url = `${BASE}/emails?search=${encodeURIComponent(`thread:${threadId}`)}&sort_order=asc&limit=20`;
  const res = await fetch(url, { headers: h() });
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
  const res = await fetch(`${BASE}/emails?${params.toString()}`, { headers: h() });
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
      headers: h(),
      body: JSON.stringify({
        campaign_id: instantlyCampaignId,
        search: leadEmail,
        limit: 5,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as { items?: Array<{ email?: string; interest_value?: number | null; pl_value?: number | null }> } | null;
    // search is fuzzy, pin to exact email match
    const match = (data?.items ?? []).find((l) => l.email?.toLowerCase() === leadEmail.toLowerCase());
    return match ?? null;
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
}): Promise<{ id?: string }> {
  const res = await fetch(`${BASE}/emails/reply`, {
    method: "POST",
    headers: h(),
    body: JSON.stringify({
      reply_to_uuid: opts.replyToUuid,
      eaccount: opts.eaccount,
      subject: opts.subject,
      body: { html: opts.bodyHtml, ...(opts.bodyText ? { text: opts.bodyText } : {}) },
    }),
  });
  return iJson<{ id?: string }>(res);
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
    headers: h(),
    body: JSON.stringify({
      lead_email: opts.leadEmail,
      interest_value: opts.interestValue,
      ...(opts.disableAutoInterest ? { disable_auto_interest: true } : {}),
    }),
  });
  await iJson<unknown>(res);
}
