import { createAdminClient } from "@/lib/supabase/admin";

export async function getLeadsCount(): Promise<number> {
  const db = createAdminClient();
  const { count, error } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("is_deleted", false);
  if (error) return 0;
  return count ?? 0;
}
