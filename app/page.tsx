import { redirect } from "next/navigation";
import { isAdminUser } from "@/lib/auth/admin";
import { LoginForm } from "@/components/auth/login-form";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user && isAdminUser(user)) {
    redirect("/dashboard");
  }

  return <LoginForm />;
}
