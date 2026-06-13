import { createClient } from "@/lib/supabase/client";

/** Browser Supabase client (cookie-backed JWT session, 24h). */
export const supabase = createClient();
