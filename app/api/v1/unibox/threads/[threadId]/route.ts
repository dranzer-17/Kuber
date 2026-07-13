import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { getThreadMessages, hydrateThreadIfStale } from "@/lib/services/unibox";
import { assertCampaignAccess } from "@/lib/auth/scope";
import { fail } from "@/lib/api-response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const { threadId } = await params;
  const db = createAdminClient();

  if (req.nextUrl.searchParams.get("hydrate") === "1") {
    await hydrateThreadIfStale(db, threadId);
  }

  const detail = await getThreadMessages(db, threadId);
  const campaignId = (detail.campaign as { id?: string } | null)?.id;
  if (user.role === "employee" && campaignId) {
    try { await assertCampaignAccess(db, user, campaignId); } catch (r) { return r as Response; }
  } else if (user.role === "employee") {
    return fail(404, "NOT_FOUND", "Thread not found");
  }
  return ok(detail);
}
