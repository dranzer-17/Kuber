import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { EnrichSchema } from "@/lib/validators/leads";
import { enrichLeads, type EnrichTarget } from "@/lib/services/enrich-leads";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = EnrichSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  if (!process.env.APOLLO_API_KEY) return fail(503, "UPSTREAM_APOLLO", "Apollo API key not configured");

  const db = createAdminClient();

  let q = db
    .from("leads")
    .select("id, apollo_id, first_name, organization_id, organizations(name)")
    .eq("lead_source", "apollo")
    .eq("has_email", true)
    .is("email", null);

  if ("campaign_id" in parsed.data) {
    const { data: memberIds } = await db
      .from("campaign_leads").select("lead_id").eq("campaign_id", parsed.data.campaign_id);
    const ids = (memberIds ?? []).map((r) => r.lead_id);
    if (ids.length === 0) return ok({ requested: 0, matched: 0, missing_apollo_ids: [], credits_consumed: 0, verified: 0, unverified: 0, remaining: 0 });
    q = q.in("id", ids).limit(parsed.data.limit);
  } else if ("import_id" in parsed.data) {
    q = q.eq("import_id", parsed.data.import_id);
  } else {
    q = q.in("id", parsed.data.lead_ids);
  }

  const { data: rows, error } = await q;
  if (error) return fail(500, "INTERNAL", error.message);
  if (!rows?.length) return ok({ requested: 0, matched: 0, missing_apollo_ids: [], credits_consumed: 0, verified: 0, unverified: 0, remaining: 0 });

  const targets: EnrichTarget[] = rows.map((t) => {
    const org = Array.isArray(t.organizations) ? t.organizations[0] : t.organizations;
    return { id: t.id, apollo_id: t.apollo_id, first_name: t.first_name, organization_id: t.organization_id, org_name: org?.name ?? null };
  });

  const stats = await enrichLeads(db, targets, 10);

  const { count: remaining } = await db
    .from("leads").select("id", { count: "exact", head: true })
    .eq("lead_source", "apollo").eq("has_email", true).is("email", null);

  return ok({
    requested: targets.length,
    matched: stats.matched,
    missing_apollo_ids: stats.missing_apollo_ids,
    credits_consumed: stats.credits_consumed,
    verified: stats.verified,
    unverified: stats.unverified,
    remaining: remaining ?? 0,
    ...(stats.warning ? { warning: stats.warning } : {}),
  });
}
