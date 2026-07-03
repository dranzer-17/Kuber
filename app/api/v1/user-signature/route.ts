import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const db = createAdminClient();
  const { data } = await db
    .from("user_signatures")
    .select("full_name, title, contact")
    .eq("user_id", user.id)
    .maybeSingle();
  return ok(data ?? { full_name: "", title: "", contact: "" });
}

export async function PATCH(req: NextRequest) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const db = createAdminClient();
  const body = await req.json().catch(() => ({})) as { full_name?: string; title?: string; contact?: string };

  const { error } = await db.from("user_signatures").upsert({
    user_id: user.id,
    full_name: body.full_name ?? "",
    title: body.title ?? "",
    contact: body.contact ?? "",
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (error) return fail(500, "INTERNAL", error.message);
  return ok({ saved: true });
}
