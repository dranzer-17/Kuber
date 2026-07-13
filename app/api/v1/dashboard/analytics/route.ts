import { NextRequest } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { getDashboardAnalytics } from "@/lib/server/dashboard";

export async function GET(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }
  const analytics = await getDashboardAnalytics(createAdminClient());
  return ok(analytics);
}
