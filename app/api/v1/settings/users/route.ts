import { NextRequest } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { CreateUserSchema } from "@/lib/validators/users";

export async function GET(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const db = createAdminClient();
  const { data, error } = await db
    .from("profiles")
    .select("id, email, full_name, role, territory, is_active, is_super_admin, created_at")
    .order("created_at", { ascending: true });

  if (error) return fail(500, "INTERNAL", error.message);
  return ok(data ?? []);
}

export async function POST(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());
  const { email, password, full_name, role, territory } = parsed.data;

  const db = createAdminClient();

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
  });
  if (createError || !created.user) {
    return fail(400, "USER_CREATE_FAILED", createError?.message ?? "Could not create user");
  }

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .insert({
      id: created.user.id,
      email,
      full_name,
      role,
      territory: role === "employee" ? (territory ?? null) : null,
      is_active: true,
    })
    .select("id, email, full_name, role, territory, is_active, is_super_admin, created_at")
    .single();

  if (profileError) {
    await db.auth.admin.deleteUser(created.user.id);
    return fail(500, "INTERNAL", profileError.message);
  }

  return ok(profile);
}
