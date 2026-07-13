import { NextRequest } from "next/server";
import { z } from "zod";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { bulkAssignByStrategy } from "@/lib/services/assignment";

const BulkAssignSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("manual"), ids: z.array(z.string().uuid()).min(1), assigned_to: z.string().uuid().nullable() }),
  z.object({ strategy: z.literal("round_robin"), ids: z.array(z.string().uuid()).min(1) }),
  z.object({ strategy: z.literal("territory"), ids: z.array(z.string().uuid()).min(1) }),
]);

export async function POST(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = BulkAssignSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  if (parsed.data.strategy === "manual" && parsed.data.assigned_to) {
    const { data: employee } = await db
      .from("profiles")
      .select("id, is_active")
      .eq("id", parsed.data.assigned_to)
      .maybeSingle();
    if (!employee || !employee.is_active) return fail(400, "INVALID_ASSIGNEE", "Employee not found or inactive");
  }

  try {
    const result = await bulkAssignByStrategy(
      db,
      parsed.data.ids,
      parsed.data.strategy,
      parsed.data.strategy === "manual" ? parsed.data.assigned_to : null,
    );
    return ok(result);
  } catch (e) {
    return fail(500, "INTERNAL", (e as Error).message);
  }
}
