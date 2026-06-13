import { NextRequest } from "next/server";
import crypto from "crypto";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { CreateLeadSchema, LeadListQuerySchema } from "@/lib/validators/leads";

const APP_SUBDOMAINS = /^(app|dashboard|portal|login|my|account|admin|web|mail|crm|api|secure)\./i;
function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")           // strip path
    .toLowerCase()
    .replace(APP_SUBDOMAINS, "");   // strip non-marketing subdomains
}

async function upsertOrg(
  db: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
  name: string,
  domain: string | undefined,
  userId: string
) {
  const normalizedDomain = domain ? normalizeDomain(domain) : null;

  if (normalizedDomain) {
    const { data: existing } = await db
      .from("organizations")
      .select("id")
      .eq("domain", normalizedDomain)
      .maybeSingle();
    if (existing) return existing.id as string;
  }

  const { data: byName } = await db
    .from("organizations")
    .select("id")
    .ilike("name", name)
    .is("apollo_org_id", null)
    .maybeSingle();
  if (byName) return byName.id as string;

  const { data: created, error } = await db
    .from("organizations")
    .insert({
      name,
      domain: normalizedDomain,
      enrichment_stage: normalizedDomain ? "queued" : null,
      enrichment_status: normalizedDomain ? "SCRAPE_QUEUED" : null,
      enrichment_attempts: 0,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id as string;
}

export async function GET(req: NextRequest) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  void user;

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = LeadListQuerySchema.safeParse(sp);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());

  const { country, email_status, lead_source, organization_id, email_domain_catchall, page, limit } = parsed.data;
  const db = createAdminClient();

  let q = db
    .from("leads")
    .select(
      `*, organizations(id, name, domain, description, unsubscribed, has_scraped, primary_products, competitors, news_summary, intent_signals, enrichment_stage, company_description, sells_to),
       campaign_leads(crm_status, created_at, campaigns(id, name))`,
      { count: "exact" }
    );

  if (country) q = q.eq("country", country);
  if (email_status) q = q.eq("email_status", email_status);
  if (lead_source) q = q.eq("lead_source", lead_source);
  if (organization_id) q = q.eq("organization_id", organization_id);
  if (email_domain_catchall !== undefined) q = q.eq("email_domain_catchall", email_domain_catchall === "true");

  q = q.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await q;
  if (error) return fail(500, "INTERNAL", error.message);

  // Derive latest crm_status from campaign_leads (most recent campaign)
  const leads = (data ?? []).map((l) => {
    const cls = (l.campaign_leads ?? []) as { crm_status: string; created_at: string; campaigns: { id: string; name: string } | null }[];
    const sorted = [...cls].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return {
      ...l,
      crm_status: sorted[0]?.crm_status ?? "new",
      campaign_list: cls
        .filter((cl) => cl.campaigns)
        .map((cl) => ({ id: cl.campaigns!.id, name: cl.campaigns!.name, crm_status: cl.crm_status })),
    };
  });

  return ok({ leads, total: count, page, limit });
}

export async function POST(req: NextRequest) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = CreateLeadSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const { organization_name, organization_domain, email, ...leadFields } = parsed.data;
  const db = createAdminClient();

  // Check email uniqueness
  const { data: existing } = await db
    .from("leads")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (existing) return fail(409, "DUPLICATE", "A lead with this email already exists", { id: existing.id });

  let organizationId: string;
  try {
    organizationId = await upsertOrg(db, organization_name, organization_domain, user.id);
  } catch (e) {
    return fail(500, "INTERNAL", (e as Error).message);
  }

  const apolloId = `manual_${crypto.randomUUID()}`;

  const { data, error } = await db
    .from("leads")
    .insert({
      ...leadFields,
      email: email.toLowerCase(),
      organization_id: organizationId,
      apollo_id: apolloId,
      lead_source: "manual",
      created_by: user.id,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return fail(500, "INTERNAL", error.message);

  // Fire enrichment if a domain was provided (new org will be queued)
  if (organization_domain && process.env.FIRECRAWL_API_KEY && process.env.INTERNAL_SECRET) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    fetch(`${baseUrl}/api/enrich/scrape-orgs`, {
      method: "POST",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET },
    }).catch(() => {});
  }

  return ok(data);
}
