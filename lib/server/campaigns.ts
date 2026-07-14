import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDbCampaign, type DbCampaign } from "@/lib/mappers";

/** List campaigns; when `scopedUserId` is given (an employee), only campaigns
 *  they created or were assigned. */
export async function getCampaigns(db: SupabaseClient, scopedUserId?: string) {
  let q = db
    .from("campaigns")
    .select("*")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });
  if (scopedUserId) q = q.or(`created_by.eq.${scopedUserId},assigned_to.eq.${scopedUserId}`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => mapDbCampaign(c as unknown as DbCampaign));
}

export async function getCampaign(db: SupabaseClient, id: string) {
  const { data, error } = await db
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return mapDbCampaign(data as unknown as DbCampaign);
}
