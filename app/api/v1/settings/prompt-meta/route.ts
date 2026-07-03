import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const db = createAdminClient();
  const { data } = await db
    .from("settings")
    .select("updated_at")
    .eq("key", "system_prompt")
    .maybeSingle();
  return ok({ updatedAt: data?.updated_at ?? null });
}
