"use server";

import { redirect } from "next/navigation";
import { isAppUser } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: error.message };

  if (!isAppUser(data.user)) {
    await supabase.auth.signOut();
    return { error: "This account does not have access." };
  }

  // Auth succeeding doesn't mean the profile is still active (e.g. a manager
  // deactivated this user after their last token expired) — block the login.
  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "This account has been deactivated. Contact your manager." };
  }

  redirect("/dashboard");
}
