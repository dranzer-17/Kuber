import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();

  const { data, error } = await db
    .from("organizations")
    .update({ has_scraped: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  if (!data) return fail(404, "NOT_FOUND", "Organization not found");

  return ok({ id, queued_for_rescrape: true });
}
