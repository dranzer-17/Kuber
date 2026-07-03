import { NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/auth/verify-jwt";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SERVICE_ROLE_USER_ID = "00000000-0000-0000-0000-000000000000";

function unauthorized(message: string) {
  return Response.json(
    { success: false, data: null, error: { code: "UNAUTHORIZED", message } },
    { status: 401 },
  );
}

/** Verifies the Bearer JWT from the Authorization header. Returns the user or throws a Response. */
export async function requireAuth(request: NextRequest): Promise<{ id: string; email?: string }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    throw unauthorized("Missing Authorization header");
  }

  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) {
    return { id: SERVICE_ROLE_USER_ID, email: "admin@service" };
  }

  const verified = await verifyAccessToken(token);
  if (verified) return verified;

  throw unauthorized("Invalid or expired token");
}
