import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { CreateCampaignSchema } from "@/lib/validators/campaigns";
import { DEFAULT_FOLLOW_UP_PATTERN } from "@/lib/constants";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const db = createAdminClient();
  const { data, error } = await db
    .from("campaigns")
    .select("*")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });

  if (error) return fail(500, "INTERNAL", error.message);
  return ok({ campaigns: data });
}

export async function POST(req: NextRequest) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = CreateCampaignSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  const { data, error } = await db
    .from("campaigns")
    .insert({
      ...parsed.data,
      follow_up_pattern: parsed.data.follow_up_pattern ?? DEFAULT_FOLLOW_UP_PATTERN,
      status: "draft",
      created_by: user.id,
      signature_user_id: parsed.data.signature_user_id ?? user.id,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return fail(500, "INTERNAL", error.message);
  return ok(data);
}
