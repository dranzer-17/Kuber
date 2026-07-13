import { NextRequest } from "next/server";
import { z } from "zod";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

const BulkAssignSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  assigned_to: z.string().uuid().nullable(),
});

export async function POST(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = BulkAssignSchema.safeParse(body);
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

  const { error, count } = await db
    .from("leads")
    .update({
      assigned_to: parsed.data.assigned_to,
      assigned_at: parsed.data.assigned_to ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .in("id", parsed.data.ids);

  if (error) return fail(500, "INTERNAL", error.message);

  return ok({ assigned: count ?? parsed.data.ids.length });
}
