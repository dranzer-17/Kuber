import { NextRequest } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const db = createAdminClient();

  const [{ data: campaigns, error: campaignsError }, { data: profiles }, { data: leadCounts }] = await Promise.all([
    db
      .from("campaigns")
      .select("id, name, status, created_by, total_leads, sent_count, opened_count, replied_count, hot_count, created_at")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false }),
    db.from("profiles").select("id, email, full_name, role, territory, is_active"),
    db.from("leads").select("assigned_to").eq("is_deleted", false).not("assigned_to", "is", null),
  ]);

  if (campaignsError) return fail(500, "INTERNAL", campaignsError.message);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const assignedLeadCounts = new Map<string, number>();
  for (const row of leadCounts ?? []) {
    if (!row.assigned_to) continue;
    assignedLeadCounts.set(row.assigned_to, (assignedLeadCounts.get(row.assigned_to) ?? 0) + 1);
  }

  const campaignsWithOwner = (campaigns ?? []).map((c) => ({
    ...c,
    owner: profileMap.get(c.created_by) ?? null,
  }));

  const employees = (profiles ?? [])
    .filter((p) => p.role === "employee")
    .map((p) => ({
      ...p,
      assigned_lead_count: assignedLeadCounts.get(p.id) ?? 0,
      campaign_count: campaignsWithOwner.filter((c) => c.created_by === p.id).length,
    }));

  return ok({ campaigns: campaignsWithOwner, employees });
}
