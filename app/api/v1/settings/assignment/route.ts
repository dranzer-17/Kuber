import { NextRequest } from "next/server";
import { requireAuth, requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchAssignmentSettingsSchema } from "@/lib/validators/users";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const db = createAdminClient();
  const { data, error } = await db
    .from("assignment_settings")
    .select("strategy, updated_at")
    .limit(1)
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  return ok(data ?? { strategy: "manual", updated_at: null });
}

export async function PATCH(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = PatchAssignmentSettingsSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();
  const { data: existing } = await db.from("assignment_settings").select("id").limit(1).maybeSingle();
  if (!existing) return fail(500, "INTERNAL", "Assignment settings row missing");

  const { data, error } = await db
    .from("assignment_settings")
    .update({ strategy: parsed.data.strategy, updated_at: new Date().toISOString() })
    .eq("id", existing.id)
    .select("strategy, updated_at")
    .single();

  if (error) return fail(500, "INTERNAL", error.message);
  return ok(data);
}
