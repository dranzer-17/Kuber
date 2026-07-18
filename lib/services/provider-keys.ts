import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderId } from "@/lib/services/providers/types";

type Db = SupabaseClient;

// Every provider's static .env.local fallback — the permanent last-resort
// tier, not just a migration bridge. With zero rows in provider_keys, every
// getActiveKey() call resolves here, so this system is a no-op on day one.
export const ENV_KEY_VARS: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
  apollo: "APOLLO_API_KEY",
  instantly: "INSTANTLY_API_KEY",
};

const ENV_MODEL_PRIMARY = "LLM_PRIMARY_MODEL"; // openrouter only, legacy name
const ENV_MODEL_FALLBACK = "LLM_FALLBACK_MODEL"; // openai only, legacy name

export type KeySource = "db" | "env";
export interface ResolvedKey {
  source: KeySource;
  keyId: string | null;
  secret: string;
}

/** Rows healthy right now, or cooling-off with an expired cooldown, ordered
 *  cheapest-to-try first. `exclude` lets a rotation loop skip keys it has
 *  already tried within the same request. */
export async function getActiveKey(
  db: Db,
  provider: ProviderId,
  opts?: { exclude?: Set<string> },
): Promise<ResolvedKey | null> {
  const exclude = opts?.exclude ?? new Set<string>();
  const nowIso = new Date().toISOString();

  const { data: rows } = await db
    .from("provider_keys")
    .select("id, secret_vault_id")
    .eq("provider", provider)
    .eq("is_active", true)
    .or(`status.eq.healthy,and(status.eq.cooling_off,cooling_off_until.lte.${nowIso})`)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  const candidate = (rows ?? []).find((r) => !exclude.has(r.id as string));

  if (candidate) {
    const { data: secret } = await db.rpc("provider_key_read_secret", { p_vault_id: candidate.secret_vault_id });
    if (typeof secret === "string" && secret) {
      return { source: "db", keyId: candidate.id as string, secret };
    }
    // Vault read failed unexpectedly (shouldn't happen for a row we just
    // selected) — fall through to the env tier rather than surface an
    // opaque failure.
  }

  const envSecret = process.env[ENV_KEY_VARS[provider]];
  if (envSecret?.trim()) return { source: "env", keyId: null, secret: envSecret };

  return null;
}

export async function getConfiguredModel(db: Db, provider: ProviderId): Promise<string | null> {
  const { data } = await db.from("provider_settings").select("selected_model").eq("provider", provider).maybeSingle();
  return data?.selected_model ?? null;
}

/** DB selection > provider's legacy env var > hardcoded default. */
export async function resolveModel(
  db: Db,
  provider: ProviderId,
  hardcodedDefault: string,
): Promise<string> {
  const dbModel = await getConfiguredModel(db, provider);
  if (dbModel) return dbModel;
  const envVar = provider === "openrouter" ? ENV_MODEL_PRIMARY : provider === "openai" ? ENV_MODEL_FALLBACK : null;
  const envModel = envVar ? process.env[envVar] : undefined;
  return envModel || hardcodedDefault;
}

export async function markKeySucceeded(db: Db, keyId: string | null): Promise<void> {
  if (!keyId) return;
  await db.from("provider_keys").update({
    status: "healthy",
    cooling_off_until: null,
    last_used_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", keyId);
}

export interface KeyFailureInfo {
  status?: number;
  message: string;
}

/** Only call this after fetchWithRetry has already exhausted its in-place
 *  retries against this exact key — 402 is non-retryable there, and 429
 *  retries in-place up to 3x before giving up, so by the time an error
 *  reaches here, retrying the same key again is not going to help. */
export async function markKeyFailed(db: Db, keyId: string | null, info: KeyFailureInfo): Promise<void> {
  if (!keyId) return;
  const now = Date.now();
  const updates: Record<string, unknown> = {
    last_error: info.message.slice(0, 500),
    last_error_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  };

  if (info.status === 401 || info.status === 403) {
    // Bad credential — no amount of waiting fixes it. Stays dead until an
    // admin fixes it or re-checks it via the UI.
    updates.status = "dead";
    updates.cooling_off_until = null;
  } else if (info.status === 402) {
    updates.status = "cooling_off";
    updates.cooling_off_until = new Date(now + 30 * 60 * 1000).toISOString();
  } else if (info.status === 429) {
    updates.status = "cooling_off";
    updates.cooling_off_until = new Date(now + 5 * 60 * 1000).toISOString();
  }
  // else (5xx, network): record last_error only, don't touch status — not
  // attributable to this specific key; rotating within the same provider
  // won't help a provider-wide outage.

  await db.from("provider_keys").update(updates).eq("id", keyId);
}
