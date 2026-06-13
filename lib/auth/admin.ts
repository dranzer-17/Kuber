import type { Session, User } from "@supabase/supabase-js";

export function isAdminUser(user: User | null | undefined): boolean {
  return user?.app_metadata?.role === "admin";
}

export function isValidAdminSession(session: Session | null): boolean {
  if (!session?.user) return false;
  if (!isAdminUser(session.user)) return false;
  if (!session.expires_at) return true;
  return session.expires_at * 1000 > Date.now();
}
