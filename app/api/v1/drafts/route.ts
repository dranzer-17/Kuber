import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { DraftsQuerySchema } from "@/lib/validators/drafts";


export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = DraftsQuerySchema.safeParse(sp);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());

  const { campaign_id, status, page, limit } = parsed.data;
  const db = createAdminClient();

  let q = db
    .from("email_drafts")
    .select(
      "*, leads(first_name, last_name, email, title, country, organizations(name, company_description, keywords))",
      { count: "exact" }
    );

  if (campaign_id) q = q.eq("campaign_id", campaign_id);
  if (status) q = q.eq("status", status);
  q = q.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await q;
  if (error) return fail(500, "INTERNAL", error.message);

  return ok({ drafts: data, total: count, page, limit });
}

/**
 * @deprecated — This inline POST generator is NOT called by the frontend.
 * The frontend uses POST /api/v1/campaigns/[id]/generate-drafts → lib/services/generate-drafts.ts.
 * Keeping GET for draft listing. POST returns 410 Gone to prevent accidental use.
 */
export async function POST() {
  return fail(
    410,
    "DEPRECATED",
    "This endpoint is deprecated. Use POST /api/v1/campaigns/{id}/generate-drafts instead.",
  );
}
