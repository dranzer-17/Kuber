import { NextRequest } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchCampaignSchema } from "@/lib/validators/campaigns";
import { patchInstantlyCampaignConfig } from "@/lib/services/instantly";
import { assertCampaignAccess } from "@/lib/auth/scope";

// PATCH /api/v1/campaigns/[id]/config
// Edits campaign schedule/config on live campaigns and syncs to all Instantly
// sub-campaigns. Unlike the main PATCH /campaigns/[id] route this is not
// restricted to draft/processing status — schedule settings (daily limit, send
// window, days) are safe to change on active campaigns.
//
// Manager-only: a campaign is a shared container (spec §5) that can hold leads
// owned by several employees at once. These settings (sender identity, daily
// limit, sending window, send days) are campaign-wide, not per-lead-owner — if
// any assignee could edit them, they'd silently change what every other
// teammate's leads in the same campaign send under. See EDGE_CASES.md §2.10.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireManager>>;
  try { user = await requireManager(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchCampaignSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();
  try { await assertCampaignAccess(db, user, id); } catch (r) { return r as Response; }

  const { data: existing } = await db.from("campaigns").select("id").eq("id", id).maybeSingle();
  if (!existing) return fail(404, "NOT_FOUND", "Campaign not found");

  // Persist to DB
  const { error } = await db
    .from("campaigns")
    .update({ ...parsed.data, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail(500, "INTERNAL", error.message);

  // Sync to all Instantly sub-campaigns (fire-and-forget per sub; collect errors)
  const { data: subs } = await db
    .from("instantly_campaigns")
    .select("instantly_campaign_id")
    .eq("campaign_id", id)
    .not("instantly_campaign_id", "is", null);

  const syncErrors: string[] = [];
  for (const sub of subs ?? []) {
    if (!sub.instantly_campaign_id) continue;
    try {
      await patchInstantlyCampaignConfig(sub.instantly_campaign_id, {
        name:       parsed.data.name,
        dailyLimit: parsed.data.daily_limit,
        windowFrom: parsed.data.window_from,
        windowTo:   parsed.data.window_to,
        timezone:   parsed.data.schedule_timezone,
        sendDays:   parsed.data.send_days,
      });
    } catch (e) {
      syncErrors.push((e as Error).message);
    }
  }

  return ok({ updated: true, sync_errors: syncErrors });
}
