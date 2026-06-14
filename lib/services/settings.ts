import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDraftSystem } from "@/lib/services/llm";

let cachedPrompt: { value: string; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

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

export function invalidateSettingsCache() {
  cachedPrompt = null;
}
