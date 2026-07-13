import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAFT_JSON_SUFFIX } from "@/lib/services/llm";

let cachedPrompt: { value: string; expiresAt: number } | null = null;
let cachedClient: { value: ClientContext; expiresAt: number } | null = null;
let cachedProductOfferings: { value: ProductOffering[]; expiresAt: number } | null = null;
let cachedReplyPrompts: { value: ReplyPrompts; expiresAt: number } | null = null;
let cachedCompanyContext: { value: string; expiresAt: number } | null = null;
let cachedGenericTemplate: { value: GenericTemplate; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export type ClientContext = {
  industry: string;
  products: string;
  targetMarkets: string;
  defaultSenderName: string;
};

const CLIENT_KEYS = [
  "client_industry",
  "client_products",
  "client_target_markets",
  "default_sender_name",
] as const;

export async function getSystemPrompt(db: SupabaseClient): Promise<string> {
  const now = Date.now();
  if (cachedPrompt && cachedPrompt.expiresAt > now) return cachedPrompt.value;

  const { data } = await db
    .from("settings")
    .select("value")
    .eq("key", "system_prompt")
    .maybeSingle();

  const value = data?.value?.trim() ?? "";
  cachedPrompt = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export { DRAFT_JSON_SUFFIX };

export async function getClientContext(db: SupabaseClient): Promise<ClientContext> {
  const now = Date.now();
  if (cachedClient && cachedClient.expiresAt > now) return cachedClient.value;

  const { data: rows } = await db
    .from("settings")
    .select("key, value")
    .in("key", [...CLIENT_KEYS]);

  const map = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value ?? ""]));

  const value: ClientContext = {
    industry: map.client_industry || "Plastics & Polymer Manufacturing",
    products: map.client_products || "Masterbatch, specialty compounds",
    targetMarkets: map.client_target_markets || "Packaging, Automotive, Consumer Goods",
    defaultSenderName: map.default_sender_name || "Kuber Polyplast",
  };

  cachedClient = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

function buildClientContextBlock(client: ClientContext): string {
  return [
    "Client context:",
    `Industry: ${client.industry}`,
    `Products: ${client.products}`,
    `Target markets: ${client.targetMarkets}`,
  ].join("\n");
}

/** Tone prompt from settings + client info, with JSON output instructions for draft generation. */
export async function getDraftSystemPrompt(db: SupabaseClient): Promise<string> {
  const base = await getSystemPrompt(db);
  const withJson =
    /["']subject["']/.test(base) && /["']body["']/.test(base) && /["']product_match["']/.test(base)
      ? base
      : `${base.trimEnd()}${DRAFT_JSON_SUFFIX}`;
  const client = await getClientContext(db);
  return `${withJson}\n\n${buildClientContextBlock(client)}`;
}

export async function getEmailSignature(db: SupabaseClient): Promise<string> {
  const { data } = await db
    .from("settings")
    .select("value")
    .eq("key", "email_signature")
    .maybeSingle();
  return data?.value?.trim() || "";
}

// ── Structured signature ────────────────────────────────────────────────────

const SIGNATURE_KEYS = [
  "signature_name",
  "signature_title",
  "signature_contact",
  "signature_company",
] as const;

const SIGNATURE_DEFAULTS = {
  name:    "Kuber Polyplast Sales Team",
  title:   "Business Development",
  // TODO: Replace +91-XXXXXXXXXX with the real phone number before sending live campaigns.
  // Also run: UPDATE settings SET value='Kuber Polyplast\n+91-<REAL_NUMBER>\nsales@kuberpolyplast.com' WHERE key='signature_contact';
  contact: "Kuber Polyplast\n+91-XXXXXXXXXX\nsales@kuberpolyplast.com",
  company: "Kuber Polyplast",
};

export interface Signature {
  name: string;
  title: string;
  contact: string;
  company: string;
}

export async function getSignature(db: SupabaseClient): Promise<Signature> {
  const { data: rows } = await db
    .from("settings")
    .select("key, value")
    .in("key", [...SIGNATURE_KEYS]);

  const map = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value ?? ""]));

  return {
    name:    map.signature_name?.trim()    || SIGNATURE_DEFAULTS.name,
    title:   map.signature_title?.trim()   || SIGNATURE_DEFAULTS.title,
    contact: map.signature_contact?.trim() || SIGNATURE_DEFAULTS.contact,
    company: map.signature_company?.trim() || SIGNATURE_DEFAULTS.company,
  };
}

// ── Per-admin campaign signature resolver ────────────────────────────────────

/**
 * Resolve the signature block for a campaign, per the resolution order:
 *   1. campaign.signature_override (free-text)
 *   2. global settings.signature_contact (the "Email Footer" setting)
 *   3. hardcoded defaults
 *
 * Returns the full text block to append to the email body.
 */
export async function resolveCampaignSignature(
  db: SupabaseClient,
  campaign: {
    signature_override?: string | null;
  },
): Promise<string> {
  // 1. Free-text override wins
  if (campaign.signature_override?.trim()) {
    return campaign.signature_override.trim();
  }

  // 2. Global settings fallback
  const sig = await getSignature(db);
  return sig.contact;
}

// ── Subject line template ─────────────────────────────────────────────────────


// ── Dynamic product offerings ─────────────────────────────────────────────────

export type ProductOffering = { name: string; description: string };

export async function getProductOfferings(db: SupabaseClient): Promise<ProductOffering[]> {
  const now = Date.now();
  if (cachedProductOfferings && cachedProductOfferings.expiresAt > now) return cachedProductOfferings.value;

  const { data } = await db
    .from("settings")
    .select("value")
    .eq("key", "product_offerings")
    .maybeSingle();

  let value: ProductOffering[] = [];
  try { value = JSON.parse(data?.value ?? "[]") as ProductOffering[]; } catch { value = []; }

  cachedProductOfferings = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

// ── Reply classification & drafting prompts ──────────────────────────────────

export type ReplyPrompts = { classifier: string; drafter: string };

export async function getReplyPrompts(db: SupabaseClient): Promise<ReplyPrompts> {
  const now = Date.now();
  if (cachedReplyPrompts && cachedReplyPrompts.expiresAt > now) return cachedReplyPrompts.value;

  const { data: rows } = await db
    .from("settings")
    .select("key, value")
    .in("key", ["reply_classifier_prompt", "reply_drafter_prompt"]);

  const map = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value ?? ""]));

  const value: ReplyPrompts = {
    classifier: map.reply_classifier_prompt?.trim() ?? "",
    drafter: map.reply_drafter_prompt?.trim() ?? "",
  };

  cachedReplyPrompts = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export async function getCompanyContext(db: SupabaseClient): Promise<string> {
  const now = Date.now();
  if (cachedCompanyContext && cachedCompanyContext.expiresAt > now) return cachedCompanyContext.value;

  const { data } = await db
    .from("settings")
    .select("value")
    .eq("key", "company_context")
    .maybeSingle();

  const value = data?.value?.trim() ?? "";
  cachedCompanyContext = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

// ── Generic (name-swap) template for un-enriched leads ────────────────────────
// Leads with no usable company profile (status "input_required" — the company has
// no website, an unscrapeable site, or enrichment failed) can still join a campaign.
// They get this ready-made template with only the recipient's name/company filled
// in, instead of an AI-personalised draft. Overridable via the settings keys
// `generic_email_subject` / `generic_email_body`; falls back to the defaults below.
// Supported placeholders in both fields: {{first_name}}, {{name}}, {{company}}.

export type GenericTemplate = { subject: string; body: string };

const GENERIC_TEMPLATE_DEFAULTS: GenericTemplate = {
  subject: "Reliable masterbatch & polymer compounds for {{company}}",
  body:
    "I hope this message finds you well. I am reaching out from Kuber Polyplast regarding {{company}}.\n\n" +
    "We manufacture colour, white, black and additive masterbatches used across packaging, moulding and extrusion. Manufacturers work with us for consistent quality batch after batch and dependable, on-time supply.\n\n" +
    "If improving material quality or cost is on your radar, I would be glad to understand {{company}}'s requirements and share options that fit. Would you be open to a short conversation?",
};

export async function getGenericTemplate(db: SupabaseClient): Promise<GenericTemplate> {
  const now = Date.now();
  if (cachedGenericTemplate && cachedGenericTemplate.expiresAt > now) return cachedGenericTemplate.value;

  const { data: rows } = await db
    .from("settings")
    .select("key, value")
    .in("key", ["generic_email_subject", "generic_email_body"]);

  const map = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value ?? ""]));

  const value: GenericTemplate = {
    subject: map.generic_email_subject?.trim() || GENERIC_TEMPLATE_DEFAULTS.subject,
    body: map.generic_email_body?.trim() || GENERIC_TEMPLATE_DEFAULTS.body,
  };

  cachedGenericTemplate = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export function invalidateSettingsCache() {
  cachedPrompt = null;
  cachedClient = null;
  cachedProductOfferings = null;
  cachedReplyPrompts = null;
  cachedCompanyContext = null;
  cachedGenericTemplate = null;
}

