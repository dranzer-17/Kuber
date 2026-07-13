import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const db = createAdminClient();

  // Employees only count hot leads assigned to them; managers see all.
  const q = user.role === "employee"
    ? db.from("campaign_leads")
        .select("id, leads!inner(assigned_to)", { count: "exact", head: true })
        .eq("lead_temperature", "hot")
        .eq("leads.assigned_to", user.id)
    : db.from("campaign_leads")
        .select("id", { count: "exact", head: true })
        .eq("lead_temperature", "hot");

  const { count } = await q;
  return ok({ hotCount: count ?? 0 });
}
