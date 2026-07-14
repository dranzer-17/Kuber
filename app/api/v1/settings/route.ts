import { NextRequest } from "next/server";
import { requireAuth, requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchSettingsSchema, SETTINGS_KEYS } from "@/lib/validators/settings";

async function readSettings(db: ReturnType<typeof createAdminClient>) {
  const { data, error } = await db.from("settings").select("key, value").in("key", [...SETTINGS_KEYS]);
  if (error) throw fail(500, "INTERNAL", error.message);

  const result: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) result[key] = "";
  for (const row of data ?? []) {
    if (row.key && row.value != null) result[row.key] = row.value;
  }
  return result;
}

// Everyone may READ company settings (the UI shows e.g. the company-default
// prompt as the inherited fallback); only managers may change them.
export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const db = createAdminClient();
  try {
    return ok(await readSettings(db));
  } catch (r) {
    return r as Response;
  }
}

export async function PATCH(req: NextRequest) {
  // Company-wide configuration: prompts/templates, product library, company
  // context, brand logo, fallback signature. Manager-only — an employee editing
  // these would rewrite every user's outreach (planning.md Phase 0.5).
  // Personal preferences live at /api/v1/me/settings instead.
  try { await requireManager(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = PatchSettingsSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    const { error } = await db.from("settings").upsert(
      { key, value },
      { onConflict: "key" },
    );
    if (error) return fail(500, "INTERNAL", error.message);
  }

  try {
    return ok(await readSettings(db));
  } catch (r) {
    return r as Response;
  }
}
