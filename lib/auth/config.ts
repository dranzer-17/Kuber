/** Admin JWT / cookie session lifetime: 24 hours */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

export const ADMIN_SESSION_COOKIE_OPTIONS = {
  maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
