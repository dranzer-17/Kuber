import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchCampaignSchema } from "@/lib/validators/campaigns";

const EDITABLE_STATUSES = new Set(["draft", "processing"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();

  const { data: campaign, error } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");

  const { data: memberships } = await db
    .from("campaign_leads")
    .select("id, crm_status, lead_id, draft_id, interest_status")
    .eq("campaign_id", id);

  return ok({ ...campaign, memberships: memberships ?? [] });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(_req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();

  const { error } = await db.from("campaigns").update({ is_deleted: true }).eq("id", id);
  if (error) return fail(500, "INTERNAL", error.message);

  return ok({ deleted: id });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchCampaignSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  const { data: existing } = await db.from("campaigns").select("status").eq("id", id).maybeSingle();
  if (!existing) return fail(404, "NOT_FOUND", "Campaign not found");
  if (!EDITABLE_STATUSES.has(existing.status)) {
    return fail(409, "CONFLICT", `Campaign in status '${existing.status}' cannot be edited`);
  }

  const { data, error } = await db
    .from("campaigns")
    .update({ ...parsed.data, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return fail(500, "INTERNAL", error.message);
  return ok(data);
}
