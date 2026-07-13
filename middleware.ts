import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isManagerUser } from "@/lib/auth/roles";

const MANAGER_ONLY_PATHS = ["/dashboard/settings/users", "/dashboard/settings/assignment", "/dashboard/oversight"];

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  if (MANAGER_ONLY_PATHS.some((p) => request.nextUrl.pathname.startsWith(p)) && !isManagerUser(user)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
