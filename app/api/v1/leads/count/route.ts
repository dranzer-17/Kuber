import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const db = createAdminClient();
  let q = db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("is_deleted", false);
  // Employees only count leads assigned to them (matches GET /leads scoping).
  if (user.role === "employee") q = q.eq("assigned_to", user.id);
  const { count, error } = await q;
  if (error) return fail(500, "INTERNAL", error.message);
  return ok({ total: count ?? 0 });
}
