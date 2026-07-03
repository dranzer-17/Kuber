import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { getDashboardAnalytics } from "@/lib/server/dashboard";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const analytics = await getDashboardAnalytics(createAdminClient());
  return ok(analytics);
}
