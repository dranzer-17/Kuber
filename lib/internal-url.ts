import type { NextRequest } from "next/server";

/** Base URL for server-to-server calls back into this app (avoids port mismatch in dev). */
export function internalAppBaseUrl(req?: NextRequest): string {
  if (req) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) {
      const proto = req.headers.get("x-forwarded-proto") ?? "http";
      return `${proto}://${host}`;
    }
  }
  return process.env.INTERNAL_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
