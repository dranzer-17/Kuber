import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

export type CreditCheck = { ok: boolean; remaining: number | null; message: string };

// Below these, treat the provider as "not enough to bother trying" — not
// necessarily literal zero, since a request can still fail on a balance that
// technically isn't empty (Firecrawl charges whole credits per scrape;
// OpenRouter's error in practice appears well before the balance hits $0).
const FIRECRAWL_MIN_CREDITS = 5;
const OPENROUTER_MIN_BALANCE_USD = 0.10;

async function setCached(db: Db, key: string, value: CreditCheck): Promise<void> {
  await db.from("settings").upsert(
    { key, value: JSON.stringify(value), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

async function fetchFirecrawlCredits(): Promise<CreditCheck> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", {
      headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` },
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

async function fetchOpenRouterCredits(): Promise<CreditCheck> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
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

/** Live, provider-specific credit check. Fails OPEN (ok: true) on any check
 *  error — a broken credit-check call must never itself block real work.
 *  Result is still recorded to `settings` for visibility, but every call
 *  hits the provider API fresh rather than trusting a stale cached value. */
async function checkCredits(db: Db, settingsKey: string, fetcher: () => Promise<CreditCheck>): Promise<CreditCheck> {
  const fresh = await fetcher();
  await setCached(db, settingsKey, fresh);
  return fresh;
}

export const checkFirecrawlCredits = (db: Db) => checkCredits(db, "credit_check_firecrawl", fetchFirecrawlCredits);
export const checkOpenRouterCredits = (db: Db) => checkCredits(db, "credit_check_openrouter", fetchOpenRouterCredits);
