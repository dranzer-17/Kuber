import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { ok, fail } from "@/lib/api-response";
import { onlyRevealedLeads } from "@/lib/server/lead-visibility";
import { dbForUser } from "@/lib/supabase/scoped";

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const db = dbForUser(user);
  // Must apply the same visibility rule as GET /leads, or the header count
  // disagrees with the list under it by exactly the pre-reveal backlog.
  let q = onlyRevealedLeads(
    db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
  );
  // Employees only count leads assigned to them (matches GET /leads scoping).
  if (user.role === "employee") q = q.eq("assigned_to", user.id);
  const { count, error } = await q;
  if (error) return fail(500, "INTERNAL", error.message);
  return ok({ total: count ?? 0 });
}
