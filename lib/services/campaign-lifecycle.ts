import type { createAdminClient } from "@/lib/supabase/admin";
import { pauseInstantlyCampaign, activateInstantlyCampaign, deleteInstantlyCampaign } from "@/lib/services/instantly";

type Db = ReturnType<typeof createAdminClient>;

async function subCampaigns(db: Db, campaignId: string) {
  const { data } = await db
    .from("instantly_campaigns")
    .select("id, instantly_campaign_id")
    .eq("campaign_id", campaignId)
    .not("instantly_campaign_id", "is", null);
  return (data ?? []).filter((s) => s.instantly_campaign_id) as Array<{ id: string; instantly_campaign_id: string }>;
}

/**
 * Pause every Instantly sub-campaign of a master, then mark the master paused.
 * THIS is the only way to actually stop Instantly from sending (incl. follow-ups).
 * Best-effort per sub — collects errors rather than aborting on the first.
 */
export async function pauseCampaign(db: Db, campaignId: string): Promise<{ paused: number; errors: string[] }> {
  const subs = await subCampaigns(db, campaignId);
  const errors: string[] = [];
  let paused = 0;
  const now = new Date().toISOString();
  for (const sub of subs) {
    try {
      await pauseInstantlyCampaign(sub.instantly_campaign_id);
      await db.from("instantly_campaigns").update({ status: "paused", updated_at: now }).eq("id", sub.id);
      paused++;
    } catch (e) {
      errors.push(`sub ${sub.id}: ${(e as Error).message}`);
    }
  }
  await db.from("campaigns").update({ status: "paused", updated_at: now }).eq("id", campaignId);
  return { paused, errors };
}

/**
 * Permanently delete every Instantly sub-campaign of a master. Used when the user
 * deletes a campaign — "delete" should remove it from Instantly, not just pause it.
 * Best-effort per sub; the caller still soft-deletes the master row afterwards.
 */
export async function deleteCampaignInstantly(db: Db, campaignId: string): Promise<{ deleted: number; errors: string[] }> {
  const subs = await subCampaigns(db, campaignId);
  const errors: string[] = [];
  let deleted = 0;
  const now = new Date().toISOString();
  for (const sub of subs) {
    try {
      await deleteInstantlyCampaign(sub.instantly_campaign_id);
      // Mark our mirror row terminal and drop the now-dead Instantly id.
      await db.from("instantly_campaigns")
        .update({ status: "completed", instantly_campaign_id: null, updated_at: now })
        .eq("id", sub.id);
      deleted++;
    } catch (e) {
      errors.push(`sub ${sub.id}: ${(e as Error).message}`);
    }
  }
  return { deleted, errors };
}

/** Re-activate every sub-campaign of a paused master and mark it active again. */
export async function resumeCampaign(db: Db, campaignId: string): Promise<{ resumed: number; errors: string[] }> {
  const subs = await subCampaigns(db, campaignId);
  const errors: string[] = [];
  let resumed = 0;
  const now = new Date().toISOString();
  for (const sub of subs) {
    try {
      await activateInstantlyCampaign(sub.instantly_campaign_id);
      await db.from("instantly_campaigns").update({ status: "active", updated_at: now }).eq("id", sub.id);
      resumed++;
    } catch (e) {
      errors.push(`sub ${sub.id}: ${(e as Error).message}`);
    }
  }
  await db.from("campaigns").update({ status: "active", updated_at: now }).eq("id", campaignId);
  return { resumed, errors };
}
