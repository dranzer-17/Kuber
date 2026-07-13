import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { runUniboxSync } from "@/lib/services/unibox";
import { safeSecretEqual } from "@/lib/auth/secret";

export const maxDuration = 55;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  const isCron = safeSecretEqual(secret, process.env.INTERNAL_SECRET);
  if (!isCron) {
    try { await requireAuth(req); } catch (r) { return r as Response; }
  }

  const result = await runUniboxSync(createAdminClient(), 8);
  return ok(result);
}

/**
 * GET handler for scheduled runs. Vercel Cron sends a GET with
 * `Authorization: Bearer <CRON_SECRET>` (set CRON_SECRET in the project env).
 * Also accepts the internal secret header. Without this, the vercel.json cron
 * (which sends GET) hit the POST-only route and 405'd — so the inbox never synced
 * automatically. (§1.3)
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const cronToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const authorized =
    safeSecretEqual(cronToken, process.env.CRON_SECRET) ||
    safeSecretEqual(req.headers.get("x-internal-secret"), process.env.INTERNAL_SECRET);
  if (!authorized) {
    return fail(401, "UNAUTHORIZED", "Cron authorization required");
  }

  const result = await runUniboxSync(createAdminClient(), 8);
  return ok(result);
}
