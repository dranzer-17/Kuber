import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAFT_JSON_SUFFIX } from "@/lib/services/llm";

let cachedPrompt: { value: string; expiresAt: number } | null = null;
let cachedClient: { value: ClientContext; expiresAt: number } | null = null;
let cachedProductOfferings: { value: ProductOffering[]; expiresAt: number } | null = null;
let cachedReplyPrompts: { value: ReplyPrompts; expiresAt: number } | null = null;
let cachedCompanyContext: { value: string; expiresAt: number } | null = null;
let cachedDraftTemplate: { value: DraftTemplateConfig; expiresAt: number } | null = null;
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
    /["']subject["']/.test(base) && /["']intro["']/.test(base) && /["']product_match["']/.test(base)
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

// ── Draft template content (offerings/accolades/highlights/rotating copy) ────
//
// This is the non-negotiable-guardrails-adjacent but purely COSMETIC part of
// draft generation: rotating opening lines, the offerings/accolades blocks,
// key-strength copy, and subject patterns. It's admin-editable from Settings
// so the draft format can change without a code deploy. The anti-fabrication
// guardrails themselves stay hardcoded in generate-drafts.ts on purpose.

export type DraftTemplateConfig = {
  subjectPatterns: string[];
  openingVariants: string[];
  companyIntroVariants: string[];
  offeringsBlock: string;
  highlightText: Record<string, string>;
  defaultHighlights: string[];
  accoladesBlock: string;
  closingNoAttachmentVariants: string[];
  closingWithAttachmentVariants: string[];
};

export const DEFAULT_DRAFT_TEMPLATE: DraftTemplateConfig = {
  subjectPatterns: [
    "Greetings from Kuber Polyplast | Exploring Opportunities with [Company Name]",
    "Introduction: Kuber Polyplast | Masterbatch Solutions for [Industry]",
    "Kuber Polyplast | Connecting with [Company Name]",
    "Exploring Synergies: Kuber Polyplast and [Company Name]",
    "Kuber Polyplast | Masterbatch & Compounds for [Industry/Country] Manufacturers",
  ],
  openingVariants: [
    "I hope this message finds you well.",
    "I hope you're having a productive week.",
    "Thank you for taking a moment to read this.",
    "Reaching out because I think this could be genuinely useful for your team.",
  ],
  companyIntroVariants: [
    "It is my pleasure to introduce Kuber Polyplast, a trusted name in the masterbatch industry with over 30 years of experience. As an ISO 9001:2015 certified company based in Delhi, we specialise in delivering top-quality products tailored to meet your needs.",
    "Kuber Polyplast has been a trusted masterbatch manufacturer for over 30 years, ISO 9001:2015 certified and based in Delhi, with a track record of tailoring products to what our clients actually need.",
    "A quick introduction: Kuber Polyplast is an ISO 9001:2015 certified masterbatch manufacturer based in Delhi with 30+ years in the industry, built around tailoring products to each client's specific requirements.",
    "For context, Kuber Polyplast is a Delhi-based, ISO 9001:2015 certified masterbatch manufacturer with over three decades of experience delivering products tailored to our clients' needs.",
  ],
  offeringsBlock: `**Our Offerings:**
• **Masterbatches**: Black, White, Colour and Additive Masterbatches
• **Application Suitability**: Tested for film extrusion, sheet extrusion, injection molding, blow molding, and roto molding`,
  highlightText: {
    capacity: "**Annual Production Capacity**: 18,000 MT",
    global: "**Global Presence**: Serving 6,670+ clients across 40+ countries",
    expertise: "**Proven Expertise**: Over 57,000 unique masterbatches developed with 1,042,440 hours of experience",
    revenue: "**Impressive Revenue**: $2.4 billion (₹20,360 crore) client revenue achieved to date",
  },
  defaultHighlights: ["global", "expertise"],
  accoladesBlock: `**Accolades & Clients:**
• **Awards**: Udaan Award (Rising Star in Masterbatch)
• **Trusted Partners**: APL Apollo, UFlex, Wipro, Phillips, BSNL, and more`,
  closingNoAttachmentVariants: [
    "If you have any questions or would like to discuss further, I'd be happy to assist. We look forward to collaborating with you.",
    "Happy to share more detail or answer any questions if this would be useful to you.",
    "Let me know if this is relevant to your work. Glad to share more detail or set up a quick call.",
  ],
  closingWithAttachmentVariants: [
    "Please find our brochure for further details on how we can support your needs. If you have any questions or would like to discuss further, I'd be happy to assist. We look forward to collaborating with you.",
    "I've attached our brochure with more detail on how we could support you. Happy to answer any questions or set up a quick call.",
    "Our brochure is attached and covers this in more depth. Let me know if you have questions or would like to set up a short call.",
  ],
};

function mergeDraftTemplate(raw: string | null | undefined): DraftTemplateConfig {
  if (!raw) return DEFAULT_DRAFT_TEMPLATE;
  try {
    const parsed = JSON.parse(raw) as Partial<DraftTemplateConfig>;
    return {
      subjectPatterns: parsed.subjectPatterns?.length ? parsed.subjectPatterns : DEFAULT_DRAFT_TEMPLATE.subjectPatterns,
      openingVariants: parsed.openingVariants?.length ? parsed.openingVariants : DEFAULT_DRAFT_TEMPLATE.openingVariants,
      companyIntroVariants: parsed.companyIntroVariants?.length ? parsed.companyIntroVariants : DEFAULT_DRAFT_TEMPLATE.companyIntroVariants,
      offeringsBlock: parsed.offeringsBlock?.trim() || DEFAULT_DRAFT_TEMPLATE.offeringsBlock,
      highlightText: { ...DEFAULT_DRAFT_TEMPLATE.highlightText, ...parsed.highlightText },
      defaultHighlights: parsed.defaultHighlights?.length ? parsed.defaultHighlights : DEFAULT_DRAFT_TEMPLATE.defaultHighlights,
      accoladesBlock: parsed.accoladesBlock?.trim() || DEFAULT_DRAFT_TEMPLATE.accoladesBlock,
      closingNoAttachmentVariants: parsed.closingNoAttachmentVariants?.length ? parsed.closingNoAttachmentVariants : DEFAULT_DRAFT_TEMPLATE.closingNoAttachmentVariants,
      closingWithAttachmentVariants: parsed.closingWithAttachmentVariants?.length ? parsed.closingWithAttachmentVariants : DEFAULT_DRAFT_TEMPLATE.closingWithAttachmentVariants,
    };
  } catch {
    return DEFAULT_DRAFT_TEMPLATE;
  }
}

export async function getDraftTemplateConfig(db: SupabaseClient): Promise<DraftTemplateConfig> {
  const now = Date.now();
  if (cachedDraftTemplate && cachedDraftTemplate.expiresAt > now) return cachedDraftTemplate.value;

  const { data } = await db
    .from("settings")
    .select("value")
    .eq("key", "draft_template_config")
    .maybeSingle();

  const value = mergeDraftTemplate(data?.value);
  cachedDraftTemplate = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export function invalidateSettingsCache() {
  cachedPrompt = null;
  cachedClient = null;
  cachedProductOfferings = null;
  cachedReplyPrompts = null;
  cachedCompanyContext = null;
  cachedDraftTemplate = null;
}

