import { NextRequest } from "next/server";
import { requireAuth, requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchOrgSchema } from "@/lib/validators/organizations";
import { getCampaignAccessibleLeadIds } from "@/lib/auth/scope";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();

  // Employees may read orgs tied to their own assigned leads, or to a lead
  // they can see via campaign access (review §3.1) — everything else is
  // manager territory.
  if (user.role === "employee") {
    const { data: assignedLead } = await db
      .from("leads")
      .select("id")
      .eq("organization_id", id)
      .eq("assigned_to", user.id)
      .eq("is_deleted", false)
      .limit(1)
      .maybeSingle();
    if (!assignedLead) {
      const campaignLeadIds = await getCampaignAccessibleLeadIds(db, user);
      const { data: viaCampaign } = campaignLeadIds.length > 0
        ? await db.from("leads").select("id").eq("organization_id", id).eq("is_deleted", false).in("id", campaignLeadIds).limit(1).maybeSingle()
        : { data: null };
      if (!viaCampaign) return fail(404, "NOT_FOUND", "Organization not found");
    }
  }

  const { data: org, error } = await db
    .from("organizations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  if (!org) return fail(404, "NOT_FOUND", "Organization not found");

  const { data: leads } = await db
    .from("leads")
    .select("id, first_name, last_name, email, email_status, title, lead_source, created_at")
    .eq("organization_id", id)
    .order("created_at", { ascending: false });

  return ok({ ...org, leads: leads ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchOrgSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  const { data, error } = await db
    .from("organizations")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  if (!data) return fail(404, "NOT_FOUND", "Organization not found");

  return ok(data);
}
