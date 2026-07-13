import { NextRequest, after } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { internalAppBaseUrl } from "@/lib/internal-url";
import { assertCampaignAccess } from "@/lib/auth/scope";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();
  try { await assertCampaignAccess(db, user, id); } catch (r) { return r as Response; }

  const { data: campaign } = await db
    .from("campaigns")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");

  const { count: leadCount } = await db
    .from("campaign_leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id);

  const now = new Date().toISOString();
  await db.from("campaigns").update({
    status: "processing",
    draft_generation_started_at: now,
    updated_at: now,
  }).eq("id", id);

  if (process.env.INTERNAL_SECRET) {
    const baseUrl = internalAppBaseUrl(req);
    const secret = process.env.INTERNAL_SECRET;
    // after() keeps the serverless function alive until this kickoff actually
    // leaves the machine — a plain un-awaited fetch can be dropped when the
    // response returns and the lambda freezes. (§1.2)
    after(async () => {
      await fetch(`${baseUrl}/api/enrich/generate-drafts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": secret,
        },
        body: JSON.stringify({ campaign_id: id }),
      }).catch(() => {});
    });
  }

  return ok({ queued: true, lead_count: leadCount ?? 0 });
}
