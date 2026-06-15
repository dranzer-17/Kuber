import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const db = createAdminClient();
  const { data, error } = await db
    .from("imports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return fail(500, "INTERNAL", error.message);
  return ok({ imports: data ?? [] });
}
