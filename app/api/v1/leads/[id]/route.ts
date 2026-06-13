import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { PatchLeadSchema } from "@/lib/validators/leads";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(_req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();

  const { data: lead, error } = await db
    .from("leads")
    .select("*, organizations(id, name, domain, description, unsubscribed, has_scraped, primary_products, competitors, news_summary, intent_signals, enrichment_stage, company_description, sells_to)")
    .eq("id", id)
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  if (!lead) return fail(404, "NOT_FOUND", "Lead not found");

  const { data: cls } = await db
    .from("campaign_leads")
    .select("crm_status, campaign_id, created_at, campaigns(id, name)")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  const campaignList = (cls ?? []).map((cl) => {
    const camp = Array.isArray(cl.campaigns) ? cl.campaigns[0] : cl.campaigns as { id: string; name: string } | null;
    return camp ? { id: camp.id, name: camp.name, crm_status: cl.crm_status } : null;
  }).filter(Boolean) as { id: string; name: string; crm_status: string }[];

  const latestCrm = cls?.[0]?.crm_status ?? "new";

  return ok({ ...lead, crm_status: latestCrm, campaign_list: campaignList });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchLeadSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();
  const { email, ...rest } = parsed.data;

  // Email dedup check if email is being changed
  if (email) {
    const { data: conflict } = await db
      .from("leads")
      .select("id")
      .eq("email", email.toLowerCase())
      .neq("id", id)
      .maybeSingle();
    if (conflict) return fail(409, "DUPLICATE", "Another lead with this email already exists");
  }

  const { data, error } = await db
    .from("leads")
    .update({
      ...rest,
      ...(email ? { email: email.toLowerCase() } : {}),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  if (!data) return fail(404, "NOT_FOUND", "Lead not found");

  return ok(data);
}
