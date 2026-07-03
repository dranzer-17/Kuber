import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const db = createAdminClient();
  const { count, error } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("is_deleted", false);
  if (error) return fail(500, "INTERNAL", error.message);
  return ok({ total: count ?? 0 });
}
