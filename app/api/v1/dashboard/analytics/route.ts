import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { getDashboardAnalytics, getEmployeeDashboard } from "@/lib/server/dashboard";

// Managers see company-wide analytics; employees get the same shape scoped to
// their own leads and campaigns (planning.md Phase 7 — previously a 403).
export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const db = createAdminClient();
  const analytics = user.role === "manager"
    ? await getDashboardAnalytics(db)
    : await getEmployeeDashboard(db, user.id);
  return ok(analytics);
}
