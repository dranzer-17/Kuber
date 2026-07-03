import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const db = createAdminClient();
  const { count } = await db
    .from("campaign_leads")
    .select("id", { count: "exact", head: true })
    .eq("lead_temperature", "hot");
  return ok({ hotCount: count ?? 0 });
}
