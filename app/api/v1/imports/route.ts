import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { ok, fail } from "@/lib/api-response";
import { dbForUser } from "@/lib/supabase/scoped";

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const db = dbForUser(user);
  const { data, error } = await db
    .from("imports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return fail(500, "INTERNAL", error.message);
  return ok({ imports: data ?? [] });
}
