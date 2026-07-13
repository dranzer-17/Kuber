import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "manager" | "employee";

type RoleBearer = { app_metadata?: Record<string, unknown> } | null | undefined;

/** Extract role from a Supabase user's app_metadata. Null if not provisioned. */
export function getUserRole(user: RoleBearer): AppRole | null {
  const role = user?.app_metadata?.role;
  return role === "manager" || role === "employee" ? role : null;
}

export function isAppUser(user: User | RoleBearer): boolean {
  return getUserRole(user) !== null;
}

export function isManagerUser(user: User | RoleBearer): boolean {
  return getUserRole(user) === "manager";
}

export function isValidSession(session: Session | null): boolean {
  if (!session?.user) return false;
  if (!isAppUser(session.user)) return false;
  if (!session.expires_at) return true;
  return session.expires_at * 1000 > Date.now();
}
