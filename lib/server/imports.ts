import type { SupabaseClient } from "@supabase/supabase-js";

export async function getImports(db: SupabaseClient) {
  const { data, error } = await db
    .from("imports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
