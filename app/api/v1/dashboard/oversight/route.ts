import { NextRequest } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const db = createAdminClient();

  const [{ data: campaigns, error: campaignsError }, { data: profiles }, { data: leadCounts }, { data: memberships }] = await Promise.all([
    db
      .from("campaigns")
      .select("id, name, status, created_by, total_leads, sent_count, opened_count, replied_count, hot_count, created_at")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false }),
    db.from("profiles").select("id, email, full_name, role, territory, is_active, availability_status, is_super_admin"),
    db.from("leads").select("assigned_to").eq("is_deleted", false).not("assigned_to", "is", null),
    // campaign_leads joined to their lead's owner — the basis for BOTH the
    // lead→campaign fan-out and the "campaigns containing this employee's
    // leads" count (spec §6).
    db.from("campaign_leads").select("campaign_id, leads!inner(assigned_to, is_deleted)").eq("leads.is_deleted", false),
  ]);

  if (campaignsError) return fail(500, "INTERNAL", campaignsError.message);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  // Leads: N = distinct live leads assigned to the employee.
  const assignedLeadCounts = new Map<string, number>();
  for (const row of leadCounts ?? []) {
    if (!row.assigned_to) continue;
    assignedLeadCounts.set(row.assigned_to, (assignedLeadCounts.get(row.assigned_to) ?? 0) + 1);
  }

  // Only LIVE campaigns count — the `campaigns` query above is already filtered
  // to is_deleted=false, so any membership whose campaign isn't in this set is
  // a deleted campaign and must be excluded (previously it wasn't, so deleting
  // a campaign left it inflating an employee's count forever).
  const liveCampaignIds = new Set((campaigns ?? []).map((c) => c.id as string));

  // Campaigns: M = number of DISTINCT LIVE campaigns that contain at least one
  // lead assigned to the employee (spec §6) — matches what the employee's own
  // campaigns list now shows (employeeCampaignIds). An employee with leads but
  // none in any live campaign correctly reports 0.
  const campaignsByEmployee = new Map<string, Set<string>>();
  for (const m of memberships ?? []) {
    const owner = (m.leads as { assigned_to?: string | null } | null)?.assigned_to;
    if (!owner || !m.campaign_id || !liveCampaignIds.has(m.campaign_id as string)) continue;
    if (!campaignsByEmployee.has(owner)) campaignsByEmployee.set(owner, new Set());
    campaignsByEmployee.get(owner)!.add(m.campaign_id as string);
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
      campaign_count: campaignsByEmployee.get(p.id)?.size ?? 0,
    }));

  return ok({ campaigns: campaignsWithOwner, employees });
}
