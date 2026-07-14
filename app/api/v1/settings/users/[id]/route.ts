import { NextRequest } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchUserSchema } from "@/lib/validators/users";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let caller: Awaited<ReturnType<typeof requireManager>>;
  try { caller = await requireManager(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchUserSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());
  const { password, role, territory, full_name, is_active, reassign_to } = parsed.data;

  const db = createAdminClient();

  const { data: existing, error: existingErr } = await db
    .from("profiles")
    .select("id, role, is_super_admin")
    .eq("id", id)
    .maybeSingle();
  if (existingErr) return fail(500, "INTERNAL", existingErr.message);
  if (!existing) return fail(404, "NOT_FOUND", "User not found");

  // The Super Admin's own role and active status are locked — nobody, including
  // the Super Admin themselves, can change them through this endpoint.
  if (existing.is_super_admin) {
    if (role !== undefined && role !== existing.role) {
      return fail(400, "VALIDATION_ERROR", "The Super Admin's role cannot be changed.");
    }
    if (is_active === false) {
      return fail(400, "VALIDATION_ERROR", "The Super Admin account cannot be deactivated.");
    }
  }

  // A manager (Super Admin or not) can never deactivate their own account —
  // there'd be no one left to undo it once they're locked out.
  if (existing.role === "manager" && existing.id === caller.id && is_active === false) {
    return fail(400, "VALIDATION_ERROR", "You cannot deactivate your own account.");
  }

  // Managers manage employees only. Anything about another manager — role,
  // password, activation, profile — is reserved for the Super Admin, so a
  // regular manager can never demote or lock out a peer (planning.md D5/Q3).
  if (!caller.isSuperAdmin) {
    if (existing.role === "manager" && existing.id !== caller.id) {
      return fail(403, "FORBIDDEN", "Only the Super Admin can manage manager accounts.");
    }
    if (role !== undefined && role !== existing.role) {
      return fail(403, "FORBIDDEN", "Only the Super Admin can change a user's role.");
    }
  }

  // Deactivating someone who still holds leads/campaigns requires the manager
  // to explicitly pick who inherits that work — no silent orphaning, and no
  // auto-guessed reassignment either.
  if (is_active === false) {
    const [{ count: heldCampaigns }, { count: heldLeads }] = await Promise.all([
      db.from("campaigns").select("id", { count: "exact", head: true }).eq("assigned_to", id).eq("is_deleted", false),
      db.from("leads").select("id", { count: "exact", head: true }).eq("assigned_to", id).eq("is_deleted", false),
    ]);

    if ((heldCampaigns ?? 0) > 0 || (heldLeads ?? 0) > 0) {
      if (!reassign_to) {
        return fail(
          400,
          "REASSIGN_REQUIRED",
          "This user still holds leads/campaigns. Pick someone to reassign them to before deactivating.",
          { held_campaigns: heldCampaigns ?? 0, held_leads: heldLeads ?? 0 },
        );
      }
      if (reassign_to === id) {
        return fail(400, "VALIDATION_ERROR", "Cannot reassign to the account being deactivated.");
      }

      const { data: newOwner } = await db
        .from("profiles")
        .select("id, role, is_active")
        .eq("id", reassign_to)
        .maybeSingle();
      if (!newOwner || !newOwner.is_active || newOwner.role !== "employee") {
        return fail(400, "INVALID_ASSIGNEE", "Reassignment target must be an active employee.");
      }

      const now = new Date().toISOString();

      const { data: heldCampaignRows } = await db
        .from("campaigns")
        .select("id")
        .eq("assigned_to", id)
        .eq("is_deleted", false);
      if (heldCampaignRows && heldCampaignRows.length > 0) {
        await db
          .from("campaigns")
          .update({ assigned_to: reassign_to, assigned_at: now, updated_by: caller.id })
          .eq("assigned_to", id)
          .eq("is_deleted", false);
        await db.from("campaign_assignments").insert(
          heldCampaignRows.map((c) => ({
            campaign_id: c.id as string,
            assigned_to: reassign_to,
            assigned_by: caller.id,
            previous_assignee: id,
          })),
        );
      }

      await db
        .from("leads")
        .update({ assigned_to: reassign_to, assigned_at: now })
        .eq("assigned_to", id)
        .eq("is_deleted", false);
    }
  }

  if (password || role || is_active !== undefined) {
    // Deactivation must also block Supabase Auth itself — banning stops both new
    // sign-ins and refresh-token renewal, so a deactivated user can't log back in
    // and loses access once their current access token expires.
    const { error: authError } = await db.auth.admin.updateUserById(id, {
      ...(password ? { password } : {}),
      ...(role ? { app_metadata: { role } } : {}),
      ...(is_active !== undefined ? { ban_duration: is_active ? "none" : "876000h" } : {}),
    });
    if (authError) return fail(400, "USER_UPDATE_FAILED", authError.message);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (full_name !== undefined) patch.full_name = full_name;
  if (role !== undefined) patch.role = role;
  if (territory !== undefined) patch.territory = role === "employee" || role === undefined ? territory : null;
  if (is_active !== undefined) patch.is_active = is_active;

  const { data, error } = await db
    .from("profiles")
    .update(patch)
    .eq("id", id)
    .select("id, email, full_name, role, territory, is_active, is_super_admin, created_at")
    .single();

  if (error) return fail(500, "INTERNAL", error.message);

  return ok(data);
}
