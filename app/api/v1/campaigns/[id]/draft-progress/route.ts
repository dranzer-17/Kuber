import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();

  const { data: campaign } = await db
    .from("campaigns")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");

  const { count: total } = await db
    .from("campaign_leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id);

  const { data: drafts } = await db
    .from("email_drafts")
    .select("status")
    .eq("campaign_id", id);

  const statusCounts: Record<string, number> = {
    generating: 0,
    draft: 0,
    approved: 0,
    sent: 0,
    failed: 0,
    rejected: 0,
  };

  for (const d of drafts ?? []) {
    const s = d.status as string;
    if (s in statusCounts) statusCounts[s]++;
  }

  const { count: pending } = await db
    .from("campaign_leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id)
    .is("draft_id", null)
    .in("crm_status", ["new", "enriched", "draft"]);

  return ok({
    total: total ?? 0,
    generating: statusCounts.generating,
    draft: statusCounts.draft,
    approved: statusCounts.approved,
    sent: statusCounts.sent,
    failed: statusCounts.failed,
    pending: pending ?? 0,
  });
}
