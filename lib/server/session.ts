import { redirect } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { isAppUser } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

/**
 * Server guard for manager-only pages. Resolves the role from `profiles`
 * (the same authoritative source as the API's requireAuth), so a demoted user
 * loses access immediately. Redirects employees to /dashboard.
 */
export async function requireManagerSession(): Promise<Session> {
  const session = await requireAppSession();
  const db = createAdminClient();
  const { data: profile } = await db
    .from("profiles")
    .select("role, is_active")
    .eq("id", session.user.id)
    .maybeSingle();
  if (!profile || !profile.is_active || profile.role !== "manager") {
    redirect("/dashboard");
  }
  return session;
}
