import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { AddLeadsToCampaignSchema, CampaignLeadsQuerySchema, PatchCampaignLeadSchema } from "@/lib/validators/campaigns";

const TERMINAL_STATUSES = new Set(["completed", "paused"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = CampaignLeadsQuerySchema.safeParse(sp);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());

  const { crm_status, page, limit } = parsed.data;
  const db = createAdminClient();

  // Fetch campaign default attachment (once)
  const { data: campaign } = await db
    .from("campaigns")
    .select("attachment_name, attachment_size, attachment_mime, attachment_url")
    .eq("id", id).maybeSingle();

  let q = db
    .from("campaign_leads")
    .select(
      `*, attachment_path, attachment_name, attachment_mime, attachment_size, attachment_url,
       leads(first_name, last_name, email, email_status, title, country, email_domain_catchall, organization_id),
       email_drafts(id, subject, body, status, created_at)`,
      { count: "exact" }
    )
    .eq("campaign_id", id);

  if (crm_status) q = q.eq("crm_status", crm_status);
  q = q.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await q;
  if (error) return fail(500, "INTERNAL", error.message);

  // Compute resolved attachment per lead
  const items = (data ?? []).map((cl: Record<string, unknown>) => ({
    ...cl,
    attachment: {
      perLead: cl.attachment_name
        ? { name: cl.attachment_name, size: cl.attachment_size, mime: cl.attachment_mime }
        : null,
      campaignDefault: campaign?.attachment_name
        ? { name: campaign.attachment_name, size: campaign.attachment_size, mime: campaign.attachment_mime }
        : null,
      effective: cl.attachment_name
        ? { name: cl.attachment_name, size: cl.attachment_size, url: cl.attachment_url ?? null, source: "lead" as const }
        : campaign?.attachment_name
        ? { name: campaign.attachment_name, size: campaign.attachment_size, url: campaign.attachment_url ?? null, source: "campaign" as const }
        : null,
    },
  }));

  return ok({ campaign_leads: items, total: count, page, limit });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = AddLeadsToCampaignSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  // Validate campaign status
  const { data: campaign } = await db.from("campaigns").select("status").eq("id", id).maybeSingle();
  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");
  if (TERMINAL_STATUSES.has(campaign.status)) {
    return fail(409, "CONFLICT", `Cannot add leads to a campaign in status '${campaign.status}'`);
  }

  const added: string[] = [];
  const notFound: string[] = [];
  const blockedUnsubscribed: string[] = [];
  const blockedNotEnriched: string[] = [];
  const skippedExisting: string[] = [];

  const leadIds = parsed.data.lead_ids;

  // Bulk-fetch all leads in one query
  const { data: leads } = await db
    .from("leads")
    .select("id, email, organization_id, organizations(domain, enrichment_stage, unsubscribed)")
    .in("id", leadIds);

  const leadMap = new Map((leads ?? []).map((l) => [l.id, l]));

  // Check existing campaign_leads in bulk
  const { data: existingCls } = await db
    .from("campaign_leads")
    .select("lead_id")
    .eq("campaign_id", id)
    .in("lead_id", leadIds);
  const existingSet = new Set((existingCls ?? []).map((r) => r.lead_id));

  const toInsert: object[] = [];
  const now = new Date().toISOString();

  for (const leadId of leadIds) {
    if (!leadMap.has(leadId)) { notFound.push(leadId); continue; }
    if (existingSet.has(leadId)) { skippedExisting.push(leadId); continue; }

    const lead = leadMap.get(leadId)!;
    const org = Array.isArray(lead.organizations) ? lead.organizations[0] : lead.organizations;

    if (org?.unsubscribed) { blockedUnsubscribed.push(leadId); continue; }

    const isEligible = !!lead.email && !!org?.domain && org.enrichment_stage === "done";
    if (!isEligible) { blockedNotEnriched.push(leadId); continue; }

    toInsert.push({ campaign_id: id, lead_id: leadId, crm_status: "enriched", created_by: user.id, created_at: now });
    added.push(leadId);
  }

  if (toInsert.length > 0) {
    const { error } = await db.from("campaign_leads").insert(toInsert);
    if (error) return fail(500, "INTERNAL", error.message);

    const { count } = await db
      .from("campaign_leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id);
    await db.from("campaigns").update({ total_leads: count ?? 0 }).eq("id", id);
  }

  return ok({
    added,
    not_found: notFound,
    blocked_unsubscribed: blockedUnsubscribed,
    blocked_not_enriched: blockedNotEnriched,
    skipped_existing: skippedExisting,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchCampaignLeadSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  const { data: campaign } = await db.from("campaigns").select("id").eq("id", id).maybeSingle();
  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");

  const { data: row } = await db
    .from("campaign_leads")
    .select("id")
    .eq("id", parsed.data.campaign_lead_id)
    .eq("campaign_id", id)
    .maybeSingle();

  if (!row) return fail(404, "NOT_FOUND", "Campaign lead not found");

  const now = new Date().toISOString();
  const { error } = await db
    .from("campaign_leads")
    .update({ crm_status: parsed.data.crm_status, updated_at: now })
    .eq("id", parsed.data.campaign_lead_id);

  if (error) return fail(500, "INTERNAL", error.message);

  return ok({ id: parsed.data.campaign_lead_id, crm_status: parsed.data.crm_status });
}
