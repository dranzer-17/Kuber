import { requireAdminSession } from "@/lib/server/session";

/** Use at the top of protected Server Components. Returns the verified session. */
export async function requireAdmin() {
  return requireAdminSession();
}
