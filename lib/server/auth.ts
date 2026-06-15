import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Use at the top of every protected Server Component / layout. */
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");
  return user;
}
