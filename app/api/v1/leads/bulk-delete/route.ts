import { NextRequest } from "next/server";
import { z } from "zod";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { removeLeadFromOutreach } from "@/lib/services/lead-removal";

export const maxDuration = 120;

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export async function POST(req: NextRequest) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = BulkDeleteSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "ids must be a non-empty array of lead IDs", parsed.error.flatten());

  const db = createAdminClient();
  const { error, count } = await db
    .from("leads")
    .update({ is_deleted: true }, { count: "exact" })
    .in("id", parsed.data.ids);

  if (error) return fail(500, "INTERNAL", error.message);

  // Deleting must actually stop outreach (planning.md Phase 5 / Q7).
  let instantlyRemoved = 0;
  const instantlyErrors: string[] = [];
  for (const id of parsed.data.ids) {
    const removal = await removeLeadFromOutreach(db, id);
    instantlyRemoved += removal.instantly_removed;
    instantlyErrors.push(...removal.instantly_errors);
  }

  return ok({
    deleted: count ?? parsed.data.ids.length,
    instantly_removed: instantlyRemoved,
    instantly_errors: instantlyErrors,
  });
}
