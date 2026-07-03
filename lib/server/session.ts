import { redirect } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { isAdminUser } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

/** Cookie session validated via getUser — redirects if not admin. */
export async function requireAdminSession(): Promise<Session> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user || !isAdminUser(user)) {
    redirect("/");
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/");

  return session;
}
