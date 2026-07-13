import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { assertCampaignAccess } from "@/lib/auth/scope";

type DraftRow = { status: string } | { status: string }[] | null;

function unwrapDraft(raw: DraftRow): { status: string } | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export async function GET(
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

  const { data: rows } = await db
    .from("campaign_leads")
    .select("id, email_drafts(status)")
    .eq("campaign_id", id);

  const statusCounts: Record<string, number> = {
    generating: 0,
    draft: 0,
    approved: 0,
    sent: 0,
    failed: 0,
    rejected: 0,
  };
  let pending = 0;

  for (const row of rows ?? []) {
    const draft = unwrapDraft(row.email_drafts as DraftRow);
    if (!draft) {
      pending++;
      continue;
    }
    const s = draft.status;
    if (s in statusCounts) statusCounts[s as keyof typeof statusCounts]++;
  }

  return ok({
    total: rows?.length ?? 0,
    generating: statusCounts.generating,
    draft: statusCounts.draft,
    approved: statusCounts.approved,
    sent: statusCounts.sent,
    failed: statusCounts.failed,
    pending,
  });
}
