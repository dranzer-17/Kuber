import { NextRequest } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchUserSchema } from "@/lib/validators/users";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchUserSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());
  const { password, role, territory, full_name, is_active } = parsed.data;

  const db = createAdminClient();

  const { data: existing, error: existingErr } = await db
    .from("profiles")
    .select("id, role")
    .eq("id", id)
    .maybeSingle();
  if (existingErr) return fail(500, "INTERNAL", existingErr.message);
  if (!existing) return fail(404, "NOT_FOUND", "User not found");

  // Never demote a manager to employee — prevents locking everyone out of Team settings.
  if (existing.role === "manager" && role === "employee") {
    return fail(400, "VALIDATION_ERROR", "Managers cannot be changed to Employee.");
  }

  if (password || role) {
    const { error: authError } = await db.auth.admin.updateUserById(id, {
      ...(password ? { password } : {}),
      ...(role ? { app_metadata: { role } } : {}),
    });
    if (authError) return fail(400, "USER_UPDATE_FAILED", authError.message);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (full_name !== undefined) patch.full_name = full_name;
  if (role !== undefined) patch.role = role;
  if (territory !== undefined) patch.territory = role === "employee" || role === undefined ? territory : null;
  if (is_active !== undefined) patch.is_active = is_active;

  const { data, error } = await db
    .from("profiles")
    .update(patch)
    .eq("id", id)
    .select("id, email, full_name, role, territory, is_active, created_at")
    .single();

  if (error) return fail(500, "INTERNAL", error.message);
  return ok(data);
}
