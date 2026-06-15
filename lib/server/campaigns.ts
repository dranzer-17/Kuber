import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDbCampaign, type DbCampaign } from "@/lib/mappers";

export async function getCampaigns(db: SupabaseClient) {
  const { data, error } = await db
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c: any) => mapDbCampaign(c as unknown as DbCampaign));
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
