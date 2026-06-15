import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function POST(req: NextRequest) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  void user;

  const body = await req.json().catch(() => null);
  if (!body?.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    return fail(400, "VALIDATION_ERROR", "ids must be a non-empty array of lead IDs");
  }

  const db = createAdminClient();
  const { error, count } = await db
    .from("leads")
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .in("id", body.ids);

  if (error) return fail(500, "INTERNAL", error.message);

  return ok({ deleted: count ?? body.ids.length });
}
