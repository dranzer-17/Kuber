import { createBrowserClient } from "@supabase/ssr";
import { ADMIN_SESSION_COOKIE_OPTIONS } from "@/lib/auth/config";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: ADMIN_SESSION_COOKIE_OPTIONS,
    }
  );
}
