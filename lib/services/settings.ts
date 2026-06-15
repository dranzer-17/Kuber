import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDraftSystem, DRAFT_JSON_SUFFIX } from "@/lib/services/llm";

let cachedPrompt: { value: string; expiresAt: number } | null = null;
let cachedClient: { value: ClientContext; expiresAt: number } | null = null;
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
    /["']subject["']/.test(base) && /["']body["']/.test(base)
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

export function invalidateSettingsCache() {
  cachedPrompt = null;
  cachedClient = null;
}
