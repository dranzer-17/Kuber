import { NextRequest } from "next/server";
import { requireAuth, requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchSettingsSchema, SETTINGS_KEYS } from "@/lib/validators/settings";
import { invalidateSettingsCache } from "@/lib/services/settings";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const db = createAdminClient();
  const { data, error } = await db.from("settings").select("key, value").in("key", [...SETTINGS_KEYS]);

  if (error) return fail(500, "INTERNAL", error.message);

  const result: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) result[key] = "";
  for (const row of data ?? []) {
    if (row.key && row.value != null) result[row.key] = row.value;
  }

  return ok(result);
}

export async function PATCH(req: NextRequest) {
  // Global config (email template, signatures, product library, generic template, …)
  // affects every user's campaigns — managers only.
  try { await requireManager(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = PatchSettingsSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    const { error } = await db.from("settings").upsert(
      { key, value, updated_at: now },
      { onConflict: "key" },
    );
    if (error) return fail(500, "INTERNAL", error.message);
  }

  invalidateSettingsCache();

  const { data } = await db.from("settings").select("key, value").in("key", [...SETTINGS_KEYS]);
  const result: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) result[key] = "";
  for (const row of data ?? []) {
    if (row.key && row.value != null) result[row.key] = row.value;
  }

  return ok(result);
}
