import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();

  const { data: draft } = await db
    .from("email_drafts")
    .select("id, lead_id, campaign_id")
    .eq("id", id)
    .maybeSingle();

  if (!draft) return fail(404, "NOT_FOUND", "Draft not found");

  const { data: versions, error } = await db
    .from("email_drafts")
    .select("id, subject, body, status, version, parent_draft_id, created_at")
    .eq("campaign_id", draft.campaign_id)
    .eq("lead_id", draft.lead_id)
    .order("version", { ascending: true });

  if (error) return fail(500, "INTERNAL", error.message);

  return ok({ versions: versions ?? [] });
}
