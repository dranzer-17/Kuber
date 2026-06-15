export type UserRole = "super_admin" | "admin" | "manager";

const ROLE_HIERARCHY: Record<UserRole, number> = {
  manager: 0,
  admin: 1,
  super_admin: 2,
};

/** Extract role from Supabase user's app_metadata. Defaults to 'admin'. */
export function getUserRole(user: { app_metadata?: Record<string, unknown> }): UserRole {
  const role = user.app_metadata?.role as string | undefined;
  if (role && role in ROLE_HIERARCHY) return role as UserRole;
  return "admin";
}

/** Check if the user's role meets the minimum required level. */
export function hasRole(user: { app_metadata?: Record<string, unknown> }, minRole: UserRole): boolean {
  const userRole = getUserRole(user);
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
};
