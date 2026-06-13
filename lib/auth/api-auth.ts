import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
// Sentinel UUID used for any request authenticated via the service-role key (admin/n8n/tests)
const SERVICE_ROLE_USER_ID = "00000000-0000-0000-0000-000000000000";

/** Verifies the Bearer JWT from the Authorization header. Returns the user or throws a Response. */
export async function requireAuth(request: NextRequest): Promise<{ id: string; email?: string }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    throw Response.json(
      { success: false, data: null, error: { code: "UNAUTHORIZED", message: "Missing Authorization header" } },
      { status: 401 }
    );
  }

  // Allow the service-role key as an admin identity (n8n automations, tests, internal scripts)
  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) {
    return { id: SERVICE_ROLE_USER_ID, email: "admin@service" };
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw Response.json(
      { success: false, data: null, error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } },
      { status: 401 }
    );
  }

  return { id: data.user.id, email: data.user.email };
}
