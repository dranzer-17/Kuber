import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDraftSystem, DRAFT_JSON_SUFFIX } from "@/lib/services/llm";
import {
  DEFAULT_EMAIL_INTRO,
  DEFAULT_EMAIL_OFFERINGS,
  DEFAULT_EMAIL_CLOSING_WITH_ATTACHMENT,
  DEFAULT_EMAIL_CLOSING_NO_ATTACHMENT,
  DEFAULT_PRODUCT_SECTIONS,
  DEFAULT_PRODUCT_HINTS,
  DEFAULT_REPLY_CLASSIFIER_PROMPT,
  DEFAULT_REPLY_DRAFTER_PROMPT,
  type KuberProductMatch,
} from "@/lib/constants";

let cachedPrompt: { value: string; expiresAt: number } | null = null;
let cachedClient: { value: ClientContext; expiresAt: number } | null = null;
let cachedEmailTemplate: { value: EmailTemplate; expiresAt: number } | null = null;
let cachedProductSections: { value: ProductSections; expiresAt: number } | null = null;
let cachedReplyPrompts: { value: ReplyPrompts; expiresAt: number } | null = null;
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

  const value = data?.value?.trim() || buildDraftSystem();
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
    /["']subject["']/.test(base) && /["']opening["']/.test(base) && /["']product_match["']/.test(base)
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
 *   2. user_signatures[campaign.signature_user_id] (explicitly chosen admin)
 *   3. user_signatures[campaign.created_by] (campaign creator — the normal case)
 *   4. global settings.signature_* fields
 *   5. hardcoded defaults
 *
 * Returns the full text block to append to the email body.
 */
export async function resolveCampaignSignature(
  db: SupabaseClient,
  campaign: {
    signature_override?: string | null;
    signature_user_id?: string | null;
    created_by?: string | null;
  },
): Promise<string> {
  // 1. Free-text override wins
  if (campaign.signature_override?.trim()) {
    return campaign.signature_override.trim();
  }

  // 2 & 3. Per-admin signature: chosen admin, else campaign creator
  const targetUserId = campaign.signature_user_id ?? campaign.created_by ?? null;
  if (targetUserId) {
    const { data: usig } = await db
      .from("user_signatures")
      .select("full_name, title, contact")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (usig?.full_name) {
      const parts = ["Best regards,", usig.full_name];
      if (usig.title)   parts.push(usig.title);
      if (usig.contact) parts.push(usig.contact);
      return parts.join("\n");
    }
  }

  // 4. Global settings fallback
  const sig = await getSignature(db);
  return sig.contact;
}

// ── Cold outreach template (intro/offerings/closing) ────────────────────────

export type EmailTemplate = {
  intro: string;
  offerings: string;
  closingWithAttachment: string;
  closingNoAttachment: string;
};

const EMAIL_TEMPLATE_KEYS = [
  "email_template_intro",
  "email_template_offerings",
  "email_template_closing_with_attachment",
  "email_template_closing_no_attachment",
] as const;

export async function getEmailTemplate(db: SupabaseClient): Promise<EmailTemplate> {
  const now = Date.now();
  if (cachedEmailTemplate && cachedEmailTemplate.expiresAt > now) return cachedEmailTemplate.value;

  const { data: rows } = await db
    .from("settings")
    .select("key, value")
    .in("key", [...EMAIL_TEMPLATE_KEYS]);

  const map = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value ?? ""]));

  const value: EmailTemplate = {
    intro: map.email_template_intro?.trim() || DEFAULT_EMAIL_INTRO,
    offerings: map.email_template_offerings?.trim() || DEFAULT_EMAIL_OFFERINGS,
    closingWithAttachment: map.email_template_closing_with_attachment?.trim() || DEFAULT_EMAIL_CLOSING_WITH_ATTACHMENT,
    closingNoAttachment: map.email_template_closing_no_attachment?.trim() || DEFAULT_EMAIL_CLOSING_NO_ATTACHMENT,
  };

  cachedEmailTemplate = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

// ── Per-product addenda + AI fit hints ───────────────────────────────────────

export type ProductSections = Record<Exclude<KuberProductMatch, "none">, { section: string; hint: string }>;

const PRODUCT_TYPES = ["black", "white", "color", "additive"] as const;

export async function getProductSections(db: SupabaseClient): Promise<ProductSections> {
  const now = Date.now();
  if (cachedProductSections && cachedProductSections.expiresAt > now) return cachedProductSections.value;

  const keys = PRODUCT_TYPES.flatMap((t) => [`product_${t}_section`, `product_${t}_hint`]);
  const { data: rows } = await db.from("settings").select("key, value").in("key", keys);
  const map = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value ?? ""]));

  const value = Object.fromEntries(
    PRODUCT_TYPES.map((t) => [
      t,
      {
        section: map[`product_${t}_section`]?.trim() || DEFAULT_PRODUCT_SECTIONS[t],
        hint: map[`product_${t}_hint`]?.trim() || DEFAULT_PRODUCT_HINTS[t],
      },
    ]),
  ) as ProductSections;

  cachedProductSections = { value, expiresAt: now + CACHE_TTL_MS };
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
    classifier: map.reply_classifier_prompt?.trim() || DEFAULT_REPLY_CLASSIFIER_PROMPT,
    drafter: map.reply_drafter_prompt?.trim() || DEFAULT_REPLY_DRAFTER_PROMPT,
  };

  cachedReplyPrompts = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export function invalidateSettingsCache() {
  cachedPrompt = null;
  cachedClient = null;
  cachedEmailTemplate = null;
  cachedProductSections = null;
  cachedReplyPrompts = null;
}

