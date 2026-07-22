import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { RegenerateDraftSchema } from "@/lib/validators/drafts";
import { regenerateOneDraft } from "@/lib/services/regenerate-draft";
import { assertDraftAccess } from "@/lib/auth/scope";

export const maxDuration = 60;

/**
 * Regenerate one draft. The regeneration itself (demote → version + 1 → generate
 * → revert on failure) lives in lib/services/regenerate-draft.ts so the bulk
 * worker produces byte-identical version history; this route is authorisation
 * plus HTTP shape.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = RegenerateDraftSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();
  try { await assertDraftAccess(db, user, id); } catch (r) { return r as Response; }

  const result = await regenerateOneDraft(db, id, {
    userId: user.id,
    customInstruction: parsed.data.custom_instruction,
  });

  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "CONFLICT" ? 409 : 500;
    return fail(status, result.code, result.reason);
  }

  return ok({ draft: result.draft });
}
