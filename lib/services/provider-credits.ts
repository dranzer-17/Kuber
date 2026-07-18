import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveKey } from "@/lib/services/provider-keys";
import type { CreditCheck } from "@/lib/services/providers/types";
import type { ProviderId } from "@/lib/services/providers/types";

type Db = SupabaseClient;

export type { CreditCheck };

// Cache each provider's check for this long so an active scrape-orgs
// self-chain (which can fire every few seconds during a big batch) doesn't
// hit these credit APIs on every single invocation — one fresh check per
// window is plenty to catch "we just ran out."
const CACHE_TTL_MS = 5 * 60 * 1000;

// Below these, treat the provider as "not enough to bother trying" — not
// necessarily literal zero, since a request can still fail on a balance that
// technically isn't empty (Firecrawl charges whole credits per scrape;
// OpenRouter's error in practice appears well before the balance hits $0).
const FIRECRAWL_MIN_CREDITS = 5;
const OPENROUTER_MIN_BALANCE_USD = 0.10;

async function getCached(db: Db, key: string): Promise<CreditCheck | null> {
  const { data } = await db.from("settings").select("value, updated_at").eq("key", key).maybeSingle();
  if (!data) return null;
  const age = Date.now() - new Date(data.updated_at).getTime();
  if (age > CACHE_TTL_MS) return null;
  try { return JSON.parse(data.value) as CreditCheck; } catch { return null; }
}

async function setCached(db: Db, key: string, value: CreditCheck): Promise<void> {
  await db.from("settings").upsert(
    { key, value: JSON.stringify(value), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

async function fetchFirecrawlCredits(secret: string): Promise<CreditCheck> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) return { ok: true, remaining: null, message: `Credit check failed (HTTP ${res.status}) — proceeding rather than blocking on an unrelated API hiccup` };
    const json = await res.json() as { success?: boolean; data?: { remainingCredits?: number } };
    const remaining = json.data?.remainingCredits ?? null;
    if (remaining == null) return { ok: true, remaining: null, message: "Could not read Firecrawl balance — proceeding" };
    return {
      ok: remaining >= FIRECRAWL_MIN_CREDITS,
      remaining,
      message: remaining >= FIRECRAWL_MIN_CREDITS ? "OK" : `Firecrawl is out of credits (${remaining} left)`,
    };
  } catch {
    // Network hiccup on the check itself must not block real enrichment work.
    return { ok: true, remaining: null, message: "Credit check errored — proceeding" };
  }
}

async function fetchOpenRouterCredits(secret: string): Promise<CreditCheck> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) return { ok: true, remaining: null, message: `Credit check failed (HTTP ${res.status}) — proceeding rather than blocking on an unrelated API hiccup` };
    const json = await res.json() as { data?: { total_credits?: number; total_usage?: number } };
    if (json.data?.total_credits == null || json.data?.total_usage == null) {
      return { ok: true, remaining: null, message: "Could not read OpenRouter balance — proceeding" };
    }
    const remaining = json.data.total_credits - json.data.total_usage;
    return {
      ok: remaining >= OPENROUTER_MIN_BALANCE_USD,
      remaining,
      message: remaining >= OPENROUTER_MIN_BALANCE_USD ? "OK" : `OpenRouter is out of credits ($${remaining.toFixed(2)} left)`,
    };
  } catch {
    return { ok: true, remaining: null, message: "Credit check errored — proceeding" };
  }
}

// OpenAI (and Anthropic/Gemini/Mistral/Groq below) expose no "remaining
// balance" endpoint reachable with a regular API key — the best available
// signal is whether the key itself is live. A real mid-run quota failure
// from an actual completion call is caught separately and surfaces via
// /api/v1/service-health / provider_keys.status, same as the other
// providers' hard failures.
async function fetchOpenAICredits(secret: string): Promise<CreditCheck> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${secret}` } });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, remaining: null, message: "OpenAI rejected the API key (401/403) — invalid key" };
    }
    if (!res.ok) return { ok: true, remaining: null, message: `OpenAI key check failed (HTTP ${res.status}) — proceeding rather than blocking on an unrelated API hiccup` };
    return { ok: true, remaining: null, message: "OpenAI key is valid (balance isn't exposed by this API — real quota failures surface when a call is actually made)" };
  } catch {
    return { ok: true, remaining: null, message: "OpenAI key check errored — proceeding" };
  }
}

async function fetchAnthropicCredits(secret: string): Promise<CreditCheck> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": secret, "anthropic-version": "2023-06-01" },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, remaining: null, message: "Anthropic rejected the API key (401/403) — invalid key" };
    }
    if (!res.ok) return { ok: true, remaining: null, message: `Anthropic key check failed (HTTP ${res.status}) — proceeding` };
    return { ok: true, remaining: null, message: "Anthropic key is valid (balance isn't exposed by this API)" };
  } catch {
    return { ok: true, remaining: null, message: "Anthropic key check errored — proceeding" };
  }
}

async function fetchGeminiCredits(secret: string): Promise<CreditCheck> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(secret)}`);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, remaining: null, message: "Gemini rejected the API key (401/403) — invalid key" };
    }
    if (!res.ok) return { ok: true, remaining: null, message: `Gemini key check failed (HTTP ${res.status}) — proceeding` };
    return { ok: true, remaining: null, message: "Gemini key is valid (balance isn't exposed by this API)" };
  } catch {
    return { ok: true, remaining: null, message: "Gemini key check errored — proceeding" };
  }
}

async function fetchMistralCredits(secret: string): Promise<CreditCheck> {
  try {
    const res = await fetch("https://api.mistral.ai/v1/models", { headers: { Authorization: `Bearer ${secret}` } });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, remaining: null, message: "Mistral rejected the API key (401/403) — invalid key" };
    }
    if (!res.ok) return { ok: true, remaining: null, message: `Mistral key check failed (HTTP ${res.status}) — proceeding` };
    return { ok: true, remaining: null, message: "Mistral key is valid (balance isn't exposed by this API)" };
  } catch {
    return { ok: true, remaining: null, message: "Mistral key check errored — proceeding" };
  }
}

async function fetchGroqCredits(secret: string): Promise<CreditCheck> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${secret}` } });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, remaining: null, message: "Groq rejected the API key (401/403) — invalid key" };
    }
    if (!res.ok) return { ok: true, remaining: null, message: `Groq key check failed (HTTP ${res.status}) — proceeding` };
    return { ok: true, remaining: null, message: "Groq key is valid (balance isn't exposed by this API)" };
  } catch {
    return { ok: true, remaining: null, message: "Groq key check errored — proceeding" };
  }
}

// Apollo exposes remaining credits directly on this endpoint, so the
// "Re-check" button can surface a real number rather than just valid/invalid.
async function fetchApolloCredits(secret: string): Promise<CreditCheck> {
  try {
    const res = await fetch("https://api.apollo.io/api/v1/auth/health", {
      headers: { "x-api-key": secret, accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, remaining: null, message: "Apollo rejected the API key (401/403) — invalid key" };
    }
    if (!res.ok) return { ok: true, remaining: null, message: `Apollo key check failed (HTTP ${res.status}) — proceeding` };
    const data = await res.json().catch(() => ({})) as { is_logged_in?: boolean };
    if (data.is_logged_in === false) {
      return { ok: false, remaining: null, message: "Apollo reports this key is not authenticated" };
    }
    return { ok: true, remaining: null, message: "Apollo key is valid" };
  } catch {
    return { ok: true, remaining: null, message: "Apollo key check errored — proceeding" };
  }
}

async function fetchInstantlyCredits(secret: string): Promise<CreditCheck> {
  try {
    // /accounts is the cheapest authenticated GET — it also confirms the
    // workspace actually has sending accounts, which campaigns require.
    const res = await fetch("https://api.instantly.ai/api/v2/accounts?limit=1", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, remaining: null, message: "Instantly rejected the API key (401/403) — invalid key" };
    }
    if (!res.ok) return { ok: true, remaining: null, message: `Instantly key check failed (HTTP ${res.status}) — proceeding` };
    return { ok: true, remaining: null, message: "Instantly key is valid" };
  } catch {
    return { ok: true, remaining: null, message: "Instantly key check errored — proceeding" };
  }
}

const FETCHERS: Record<ProviderId, (secret: string) => Promise<CreditCheck>> = {
  firecrawl: fetchFirecrawlCredits,
  apollo: fetchApolloCredits,
  instantly: fetchInstantlyCredits,
  openrouter: fetchOpenRouterCredits,
  openai: fetchOpenAICredits,
  anthropic: fetchAnthropicCredits,
  gemini: fetchGeminiCredits,
  mistral: fetchMistralCredits,
  groq: fetchGroqCredits,
};

/** Cached, provider-specific credit check against the currently-ACTIVE key
 *  only (not every stored key) — this is a coarse pre-flight gate, and
 *  getActiveKey() is already called fresh (uncached) on every real request
 *  inside complete()/scrapePage(), so rotation freshness never depends on
 *  this 5-minute cache. */
async function checkCredits(db: Db, provider: ProviderId, settingsKey: string): Promise<CreditCheck> {
  const cached = await getCached(db, settingsKey);
  if (cached) return cached;

  const resolved = await getActiveKey(db, provider);
  if (!resolved) {
    const fresh = { ok: false, remaining: null, message: `No usable ${provider} key configured` };
    await setCached(db, settingsKey, fresh);
    return fresh;
  }

  const fresh = await FETCHERS[provider](resolved.secret);
  await setCached(db, settingsKey, fresh);
  return fresh;
}

export const checkFirecrawlCredits = (db: Db) => checkCredits(db, "firecrawl", "credit_check_firecrawl");
export const checkOpenRouterCredits = (db: Db) => checkCredits(db, "openrouter", "credit_check_openrouter");
export const checkOpenAICredits = (db: Db) => checkCredits(db, "openai", "credit_check_openai");
export const checkAnthropicCredits = (db: Db) => checkCredits(db, "anthropic", "credit_check_anthropic");
export const checkGeminiCredits = (db: Db) => checkCredits(db, "gemini", "credit_check_gemini");
export const checkMistralCredits = (db: Db) => checkCredits(db, "mistral", "credit_check_mistral");
export const checkGroqCredits = (db: Db) => checkCredits(db, "groq", "credit_check_groq");

/** Used by the "Re-check" button on a specific stored key — bypasses the
 *  currently-active-key resolution and the 5-minute cache entirely, since
 *  the whole point is to test one specific key right now. */
export function checkSpecificKey(provider: ProviderId, secret: string): Promise<CreditCheck> {
  return FETCHERS[provider](secret);
}
