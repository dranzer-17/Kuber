import { createBrowserClient } from "@supabase/ssr";
import { ADMIN_SESSION_COOKIE_OPTIONS } from "@/lib/auth/config";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: ADMIN_SESSION_COOKIE_OPTIONS,
      // Middleware already refreshes the session (via getUser()) on every
      // request. A second auto-refresh timer here races the same single-use
      // rotating refresh token — whichever loses gets "Already Used" and is
      // force-signed-out, which is why login didn't persist across restarts.
      auth: {
        autoRefreshToken: false,
      },
    }
  );
}
