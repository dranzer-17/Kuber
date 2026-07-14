import { NextRequest } from "next/server";
import { requireAuth, requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchLeadSchema } from "@/lib/validators/leads";
import { getCampaignAccessibleLeadIds } from "@/lib/auth/scope";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(_req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();

  const { data: lead, error } = await db
    .from("leads")
    .select("*, organizations(id, name, domain, unsubscribed, has_scraped, enrichment_stage, company_description, sells_to, last_error), imports(id, label, color)")
    .eq("id", id)
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  if (!lead) return fail(404, "NOT_FOUND", "Lead not found");
  // View access: direct assignment OR a campaign the employee has access to
  // (matches Unibox's broader visibility — review §3.1/§4.1). Editing (PATCH,
  // below) is intentionally narrower — direct assignment only.
  if (user.role === "employee" && lead.assigned_to !== user.id) {
    const accessibleIds = await getCampaignAccessibleLeadIds(db, user);
    if (!accessibleIds.includes(id)) return fail(404, "NOT_FOUND", "Lead not found");
  }

  const { data: cls } = await db
    .from("campaign_leads")
    .select("crm_status, campaign_id, created_at, campaigns(id, name)")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  const campaignList = (cls ?? []).map((cl) => {
    const camp = Array.isArray(cl.campaigns) ? cl.campaigns[0] : cl.campaigns as { id: string; name: string } | null;
    return camp ? { id: camp.id, name: camp.name, crm_status: cl.crm_status } : null;
  }).filter(Boolean) as { id: string; name: string; crm_status: string }[];

  // Org-level enrichment fans out to every lead under that org regardless of
  // owner (review §3.4) — surface a lightweight "shared" signal (counts only,
  // no other owners' lead details) so the viewer isn't blindsided by data
  // that changed underneath them from someone else's trigger.
  let orgShared: { other_lead_count: number; other_owner_count: number } | null = null;
  if (lead.organization_id) {
    const { data: orgLeads } = await db
      .from("leads")
      .select("assigned_to")
      .eq("organization_id", lead.organization_id)
      .eq("is_deleted", false)
      .neq("id", id);
    const otherOwners = new Set((orgLeads ?? []).map((l) => l.assigned_to).filter(Boolean));
    orgShared = { other_lead_count: (orgLeads ?? []).length, other_owner_count: otherOwners.size };
  }

  return ok({ ...lead, campaign_list: campaignList, org_shared: orgShared });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireManager(_req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();

  const { error } = await db.from("leads").update({ is_deleted: true }).eq("id", id);
  if (error) return fail(500, "INTERNAL", error.message);

  // Deleting must actually stop outreach: remove from Instantly (kills
  // follow-ups) and clean campaign memberships (planning.md Phase 5 / Q7).
  const { removeLeadFromOutreach } = await import("@/lib/services/lead-removal");
  const removal = await removeLeadFromOutreach(db, id);

  return ok({ deleted: id, ...removal });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: { id: string; role: "manager" | "employee" };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchLeadSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  if (user.role === "employee") {
    const { data: owned } = await db.from("leads").select("assigned_to").eq("id", id).maybeSingle();
    if (!owned || owned.assigned_to !== user.id) return fail(404, "NOT_FOUND", "Lead not found");
  }

  const { email, assigned_to, ...rest } = parsed.data;

  // Single-lead reassignment is a manager-only action (review §3.2) — the
  // only prior path was bulk-assign or a campaign-assign side effect.
  if (assigned_to !== undefined) {
    if (user.role !== "manager") return fail(403, "FORBIDDEN", "Only managers can reassign leads");
    if (assigned_to) {
      const { data: assignee } = await db
        .from("profiles")
        .select("id, is_active")
        .eq("id", assigned_to)
        .maybeSingle();
      if (!assignee || !assignee.is_active) return fail(400, "INVALID_ASSIGNEE", "Employee not found or inactive");
    }
  }

  // Email dedup check if email is being changed
  if (email) {
    const { data: conflict } = await db
      .from("leads")
      .select("id")
      .eq("email", email.toLowerCase())
      .eq("is_deleted", false)
      .neq("id", id)
      .maybeSingle();
    if (conflict) return fail(409, "DUPLICATE", "Another lead with this email already exists");
  }

  const { data, error } = await db
    .from("leads")
    .update({
      ...rest,
      ...(email ? { email: email.toLowerCase() } : {}),
      ...(assigned_to !== undefined ? { assigned_to, assigned_at: assigned_to ? new Date().toISOString() : null } : {}),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  if (!data) return fail(404, "NOT_FOUND", "Lead not found");

  return ok(data);
}
