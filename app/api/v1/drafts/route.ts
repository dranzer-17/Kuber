import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { GenerateDraftsSchema, DraftsQuerySchema } from "@/lib/validators/drafts";
import { complete, buildDraftSystem, DraftOutput } from "@/lib/services/llm";
import { KUBER_CONTEXT } from "@/lib/constants";
import { z } from "zod";

export const maxDuration = 300;

const DraftSchema = z.object({ subject: z.string(), body: z.string() });

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
      "*, leads(first_name, last_name, email, title, country, organizations(name, description, primary_products, keywords))",
      { count: "exact" }
    );

  if (campaign_id) q = q.eq("campaign_id", campaign_id);
  if (status) q = q.eq("status", status);
  q = q.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);

  const { data, error, count } = await q;
  if (error) return fail(500, "INTERNAL", error.message);

  return ok({ drafts: data, total: count, page, limit });
}

export async function POST(req: NextRequest) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = GenerateDraftsSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const { campaign_id, lead_ids, limit } = parsed.data;
  const db = createAdminClient();

  // Get campaign for human_in_loop setting
  const { data: campaign } = await db
    .from("campaigns")
    .select("id, human_in_loop")
    .eq("id", campaign_id)
    .maybeSingle();
  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");

  // Target: enriched leads with no draft (or failed draft)
  let q = db
    .from("campaign_leads")
    .select("id, lead_id, draft_id, leads(id, first_name, last_name, title, seniority, country, organization_id, organizations(name, description, primary_products, keywords))")
    .eq("campaign_id", campaign_id)
    .or("crm_status.eq.enriched,crm_status.eq.draft")
    .is("draft_id", null)
    .limit(limit);

  if (lead_ids && lead_ids.length > 0) q = q.in("lead_id", lead_ids);

  // Also include failed drafts for regeneration
  const { data: targets } = await q;

  let generated = 0;
  let generatedFailed = 0;
  let autoApproved = 0;
  const tierStats = { tier1: 0, tier2: 0 };

  for (const target of targets ?? []) {
    const lead = Array.isArray(target.leads) ? target.leads[0] : target.leads;
    if (!lead) continue;

    const org = Array.isArray(lead.organizations) ? lead.organizations[0] : lead.organizations;

    // Build prompt
    const userContent = JSON.stringify({
      first_name: lead.first_name,
      title: lead.title,
      seniority: lead.seniority,
      country: lead.country,
      company: {
        name: org?.name,
        description: org?.description,
        primary_products: org?.primary_products,
        keywords: org?.keywords,
      },
      kuber_context: KUBER_CONTEXT,
    });

    // Insert draft as generating
    const { data: draft, error: dErr } = await db
      .from("email_drafts")
      .insert({
        lead_id: lead.id,
        campaign_id,
        status: "generating",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (dErr) { generatedFailed++; continue; }

    try {
      const { json, tier } = await complete<DraftOutput>({
        system: buildDraftSystem(),
        user: userContent,
      });

      const validated = DraftSchema.safeParse(json);
      if (!validated.success) throw new Error("Draft shape mismatch");

      const finalStatus = campaign.human_in_loop ? "draft" : "approved";
      const now = new Date().toISOString();

      await db.from("email_drafts").update({
        subject: validated.data.subject,
        body: validated.data.body,
        status: finalStatus,
        ...(finalStatus === "approved" ? { approved_at: now, reviewed_by: user.id } : {}),
        updated_at: now,
      }).eq("id", draft.id);

      // Link draft to campaign_lead
      await db.from("campaign_leads").update({
        draft_id: draft.id,
        crm_status: finalStatus === "approved" ? "approved" : "draft",
        updated_at: now,
      }).eq("id", target.id);

      if (tier === 1) tierStats.tier1++; else tierStats.tier2++;
      generated++;
      if (finalStatus === "approved") autoApproved++;
    } catch {
      await db.from("email_drafts").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", draft.id);
      generatedFailed++;
    }
  }

  const { count: remaining } = await db
    .from("campaign_leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("crm_status", "enriched")
    .is("draft_id", null);

  return ok({ generated, failed: generatedFailed, auto_approved: autoApproved, llm_tier_stats: tierStats, remaining: remaining ?? 0 });
}
