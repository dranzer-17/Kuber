import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { runUniboxSync } from "@/lib/services/unibox";

export const maxDuration = 55;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  const isCron = secret && process.env.INTERNAL_SECRET && secret === process.env.INTERNAL_SECRET;
  if (!isCron) {
    try { await requireAuth(req); } catch (r) { return r as Response; }
  }

  const result = await runUniboxSync(createAdminClient(), 8);
  return ok(result);
}
