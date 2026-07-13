import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCampaignAccess } from "@/lib/auth/scope";
import { ok, fail } from "@/lib/api-response";
import { pauseCampaign } from "@/lib/services/campaign-lifecycle";

export const maxDuration = 60;

/** Pause a live campaign — actually stops Instantly from sending (and its follow-ups). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;
  const db = createAdminClient();
  try { await assertCampaignAccess(db, user, id); } catch (r) { return r as Response; }

  try {
    const result = await pauseCampaign(db, id);
    return ok(result);
  } catch (err) {
    return fail(502, "INSTANTLY_ERROR", (err as Error).message);
  }
}
