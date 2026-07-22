import { NextRequest } from "next/server";
import { requireAuth, type AuthedUser } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchSettingsSchema, SETTINGS_KEYS, KNOWLEDGE_SETTINGS_KEYS } from "@/lib/validators/settings";

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
  // context, brand logo, fallback signature. Prompt-shaped keys stay
  // manager-only — an employee editing those would rewrite every user's
  // outreach (planning.md Phase 0.5). The Knowledge Sources keys are the
  // exception: employees live in that material day to day, so they may edit it.
  // Personal preferences live at /api/v1/me/settings instead.
  let caller: AuthedUser;
  try { caller = await requireAuth(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = PatchSettingsSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  if (caller.role !== "manager") {
    const allowed = new Set<string>(KNOWLEDGE_SETTINGS_KEYS);
    const denied = Object.keys(parsed.data).filter(
      (key) => parsed.data[key as keyof typeof parsed.data] !== undefined && !allowed.has(key),
    );
    if (denied.length > 0) {
      return fail(403, "FORBIDDEN", `Manager access required to change: ${denied.join(", ")}`);
    }
  }

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
