import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDbCampaign, type DbCampaign } from "@/lib/mappers";
import { employeeCampaignIds } from "@/lib/auth/scope";

/** List campaigns; when `scopedUserId` is given (an employee), only campaigns
 *  they created, were assigned, OR that contain a lead assigned to them — the
 *  same rule as the API + detail access check (via employeeCampaignIds), so
 *  the list no longer hides campaigns an employee owns leads inside. */
export async function getCampaigns(db: SupabaseClient, scopedUserId?: string) {
  if (scopedUserId) {
    const ids = await employeeCampaignIds(db, scopedUserId);
    if (ids.length === 0) return [];
    const { data, error } = await db
      .from("campaigns")
      .select("*")
      .eq("is_deleted", false)
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((c) => mapDbCampaign(c as unknown as DbCampaign));
  }

  const { data, error } = await db
    .from("campaigns")
    .select("*")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });
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
