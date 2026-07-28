import type { SupabaseClient } from "@supabase/supabase-js";

/** Takes the caller's company-scoped client — counting every tenant's leads
 *  here would put Company A's total in Company B's sidebar. */
export async function getLeadsCount(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("is_deleted", false);
  if (error) return 0;
  return count ?? 0;
}
