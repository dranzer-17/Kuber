import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCustomVariables, updateInstantlyLeadVariables } from "@/lib/services/instantly";

export type InstantlySyncResult = { attempted: boolean; synced: boolean; error?: string };

/**
 * If this lead was already pushed to Instantly (has instantly_lead_id), push
 * an approved draft's content there too — Instantly only reads custom_variables
 * once, at the initial add, and never again on its own. Without this, approving
 * a follow-up draft after the lead's initial send silently never reaches Instantly.
 */
export async function syncApprovedDraftToInstantly(
  db: SupabaseClient,
  leadId: string,
  campaignId: string,
): Promise<InstantlySyncResult> {
  const { data: cl } = await db
    .from("campaign_leads")
    .select("instantly_lead_id")
    .eq("campaign_id", campaignId)
    .eq("lead_id", leadId)
    .maybeSingle();

  if (!cl?.instantly_lead_id) return { attempted: false, synced: false }; // not sent yet — initial push will carry current drafts

  const [{ data: campaign }, { data: drafts }] = await Promise.all([
    db.from("campaigns").select("sender_name").eq("id", campaignId).maybeSingle(),
    db.from("email_drafts")
      .select("step_number, subject, body")
      .eq("campaign_id", campaignId)
      .eq("lead_id", leadId)
      .in("status", ["approved", "sent"]),
  ]);

  if (!drafts || drafts.length === 0) return { attempted: false, synced: false };

  const customVariables = buildCustomVariables(drafts, campaign?.sender_name);
  try {
    await updateInstantlyLeadVariables(cl.instantly_lead_id, customVariables);
    return { attempted: true, synced: true };
  } catch (e) {
    console.error("updateInstantlyLeadVariables failed:", e);
    return { attempted: true, synced: false, error: (e as Error).message };
  }
}
