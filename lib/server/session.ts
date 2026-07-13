import { redirect } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { isAppUser } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

/** Cookie session validated via getUser — redirects if not a provisioned manager/employee. */
export async function requireAppSession(): Promise<Session> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user || !isAppUser(user)) {
    redirect("/");
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/");

  return session;
}
