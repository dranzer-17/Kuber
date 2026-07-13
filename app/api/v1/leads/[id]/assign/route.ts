import { NextRequest } from "next/server";
import { z } from "zod";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

const AssignLeadSchema = z.object({ assigned_to: z.string().uuid().nullable() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = AssignLeadSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  if (parsed.data.assigned_to) {
    const { data: employee } = await db
      .from("profiles")
      .select("id, is_active")
      .eq("id", parsed.data.assigned_to)
      .maybeSingle();
    if (!employee || !employee.is_active) return fail(400, "INVALID_ASSIGNEE", "Employee not found or inactive");
  }

  const { data, error } = await db
    .from("leads")
    .update({
      assigned_to: parsed.data.assigned_to,
      assigned_at: parsed.data.assigned_to ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  if (!data) return fail(404, "NOT_FOUND", "Lead not found");

  return ok(data);
}
