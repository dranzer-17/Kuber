import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// No manager-only routes left: Oversight folded into Campaigns (owner column)
// and Team folded into a section on /settings, both gated client-side by role
// rather than by URL, so there's nothing left for this middleware to redirect on.
export async function middleware(request: NextRequest) {
  const { response } = await updateSession(request);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
