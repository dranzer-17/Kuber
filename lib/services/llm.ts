import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveKey, markKeyFailed, markKeySucceeded, resolveModel } from "@/lib/services/provider-keys";
import { LLM_CALL_REGISTRY, PROVIDER_META, resolveLlmTierOrder, type LlmProviderId } from "@/lib/services/providers/registry";
import type { CompletionOpts } from "@/lib/services/providers/types";

export type { CompletionOpts };

export interface LlmResult<T> {
  json: T;
  tier: number; // position (1-indexed) in the resolved tier order of the provider that served this
}

/** Exhausts every configured key for one provider (priority order, via
 *  provider-keys.ts) before giving up on that provider entirely. Only
 *  returns null when the provider has no usable key at all (no DB row and
 *  no env fallback) — that's "skip this tier," not a failure to report. */
async function tryProvider<T>(db: SupabaseClient, provider: LlmProviderId, opts: CompletionOpts): Promise<T | null> {
  const call = LLM_CALL_REGISTRY[provider];
  const meta = PROVIDER_META[provider];
  const tried = new Set<string>();
  let lastErr: Error | null = null;

  for (;;) {
    const resolved = await getActiveKey(db, provider, { exclude: tried });
    if (!resolved) break;

    try {
      const model = await resolveModel(db, provider, meta.defaultModel ?? "");
      const json = (await call(resolved.secret, model, opts)) as T;
      if (resolved.keyId) await markKeySucceeded(db, resolved.keyId);
      return json;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (!resolved.keyId) break; // env-sourced — nothing left to rotate to
      await markKeyFailed(db, resolved.keyId, { status: (err as { status?: number }).status, message: lastErr.message });
      tried.add(resolved.keyId);
    }
  }

  if (lastErr) throw lastErr;
  return null; // provider not configured at all — not an error, just skip this tier
}

export async function complete<T = object>(opts: CompletionOpts, db?: SupabaseClient): Promise<LlmResult<T>> {
  const client = db ?? createAdminClient();
  const tierOrder = await resolveLlmTierOrder(client);
  const errors: string[] = [];

  for (let i = 0; i < tierOrder.length; i++) {
    const provider = tierOrder[i];
    try {
      const json = await tryProvider<T>(client, provider, opts);
      if (json !== null) return { json, tier: i + 1 };
    } catch (err) {
      errors.push(`${PROVIDER_META[provider].label}: ${(err as Error).message}`);
    }
  }

  if (errors.length) throw new Error(errors.join(" | "));
  throw new Error("No LLM provider configured — add a key in Settings > Keys, or set an env var like OPENROUTER_API_KEY");
}

export interface ExtractionOutput {
  description: string;
  primary_products: string[];
}

export const EXTRACTION_SYSTEM = `You extract company facts for B2B sales. Return ONLY valid JSON, no markdown fences: { "description": string (2-3 sentences: what they manufacture and who they sell to), "primary_products": string[] }`;

export const DRAFT_JSON_SUFFIX =
  '\n\nReturn ONLY valid JSON with no markdown fences: {"subject": string, "body": string, "product_match": string}.\n' +
  'product_match must be the exact name of the matched product from the PRODUCT REFERENCE LIBRARY, or "none" if no product fits.\n' +
  '"body" is the full email body for a first email (opening through closing, following the structure and approved copy in the system prompt), or the full 2-4 sentence follow-up nudge. Do not include a greeting or signature — those are added in code.\n' +
  '"subject" is the filled subject line for a first email; for a follow-up you may return an empty string (the subject is cleared in code anyway).';

