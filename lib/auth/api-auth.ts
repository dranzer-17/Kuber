import { NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/auth/verify-jwt";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/auth/roles";
import { SERVICE_ROLE_USER_ID } from "@/lib/constants";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export type AuthedUser = { id: string; email?: string; role: AppRole; isSuperAdmin: boolean };

function unauthorized(message: string) {
  return Response.json(
    { success: false, data: null, error: { code: "UNAUTHORIZED", message } },
    { status: 401 },
  );
}

function forbidden(message: string) {
  return Response.json(
    { success: false, data: null, error: { code: "FORBIDDEN", message } },
    { status: 403 },
  );
}

/**
 * Verifies the Bearer JWT and resolves the caller's role from `profiles` (not the JWT claim) so a
 * role change takes effect immediately, without waiting on token refresh. Returns the user or throws a Response.
 */
export async function requireAuth(request: NextRequest): Promise<AuthedUser> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    throw unauthorized("Missing Authorization header");
  }

  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) {
    return { id: SERVICE_ROLE_USER_ID, email: "admin@service", role: "manager", isSuperAdmin: true };
  }

  const verified = await verifyAccessToken(token);
  if (!verified) {
    throw unauthorized("Invalid or expired token");
  }

  const db = createAdminClient();
  const { data: profile } = await db
    .from("profiles")
    .select("role, is_active, is_super_admin")
    .eq("id", verified.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    throw unauthorized("Account is inactive or not provisioned");
  }

  return { id: verified.id, email: verified.email, role: profile.role as AppRole, isSuperAdmin: profile.is_super_admin };
}

/** Like requireAuth, but 403s unless the caller is a manager. */
export async function requireManager(request: NextRequest): Promise<AuthedUser> {
  const user = await requireAuth(request);
  if (user.role !== "manager") {
    throw forbidden("Manager access required");
  }
  return user;
}
