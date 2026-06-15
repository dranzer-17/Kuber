import type { SupabaseClient } from "@supabase/supabase-js";
import { bulkMatchChunked } from "@/lib/services/apollo";

const APP_SUBDOMAINS = /^(app|dashboard|portal|login|my|account|admin|web|mail|crm|api|secure)\./i;
function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")           // strip path
    .toLowerCase()
    .replace(APP_SUBDOMAINS, "");   // strip non-marketing subdomains
}

export interface EnrichLeadsResult {
  matched: number;
  verified: number;
  unverified: number;
  credits_consumed: number;
  missing_apollo_ids: string[];
  enriched_org_ids: string[];
  warning?: string;
}

export interface EnrichTarget {
  id: string;          // DB lead UUID
  apollo_id: string;
  first_name: string | null;
  organization_id: string | null;
  org_name: string | null;
}

export async function enrichLeads(
  db: SupabaseClient,
  targets: EnrichTarget[],
  chunkSize = 10,
): Promise<EnrichLeadsResult> {
  const details = targets.map((t) => ({
    id: t.apollo_id,
    first_name: t.first_name ?? undefined,
    organization_name: t.org_name ?? undefined,
  }));

  let matched = 0;
  let verified = 0;
  let unverified = 0;
  let totalCredits = 0;
  const missingApolloIds: string[] = [];
  const enrichedOrgIds = new Set<string>();
  let warning: string | undefined;

  try {
    const { results, totalCredits: tc } = await bulkMatchChunked(details, chunkSize);
    totalCredits = tc;

    for (const result of results) {
      for (const match of result.matches ?? []) {
        const lead = targets.find((t) => t.apollo_id === match.id);
        if (!lead) continue;

        matched++;
        if (match.email_status === "verified") verified++; else unverified++;

        // Org upsert-merge (§4.2 rule)
        let orgId = lead.organization_id;

        if (match.organization_id && match.organization) {
          const { data: byApolloOrg } = await db
            .from("organizations")
            .select("id")
            .eq("apollo_org_id", match.organization_id)
            .maybeSingle();

          if (byApolloOrg) {
            orgId = byApolloOrg.id;
            await db.from("organizations").update({
              name: match.organization.name ?? undefined,
              domain: match.organization.primary_domain ? normalizeDomain(match.organization.primary_domain) : undefined,
              website: match.organization.website_url ?? undefined,
              industry: match.organization.industry ?? undefined,
              keywords: match.organization.keywords ?? undefined,
              employees: match.organization.estimated_num_employees ?? undefined,
              city: match.organization.city ?? undefined,
              country: match.organization.country ?? undefined,
              updated_at: new Date().toISOString(),
            }).eq("id", byApolloOrg.id);
          } else {
            const { data: byName } = await db
              .from("organizations")
              .select("id")
              .ilike("name", match.organization.name ?? "")
              .is("apollo_org_id", null)
              .maybeSingle();

            if (byName) {
              orgId = byName.id;
              await db.from("organizations").update({
                apollo_org_id: match.organization_id,
                domain: match.organization.primary_domain ? normalizeDomain(match.organization.primary_domain) : undefined,
                website: match.organization.website_url ?? undefined,
                industry: match.organization.industry ?? undefined,
                keywords: match.organization.keywords ?? undefined,
                employees: match.organization.estimated_num_employees ?? undefined,
                city: match.organization.city ?? undefined,
                country: match.organization.country ?? undefined,
                updated_at: new Date().toISOString(),
              }).eq("id", byName.id);
            } else {
              const { data: newOrg } = await db.from("organizations").insert({
                apollo_org_id: match.organization_id,
                name: match.organization.name ?? "Unknown",
                domain: match.organization.primary_domain ? normalizeDomain(match.organization.primary_domain) : null,
                website: match.organization.website_url ?? null,
                industry: match.organization.industry ?? null,
                keywords: match.organization.keywords ?? null,
                employees: match.organization.estimated_num_employees ?? null,
                city: match.organization.city ?? null,
                country: match.organization.country ?? null,
                created_at: new Date().toISOString(),
              }).select("id").single();
              if (newOrg) orgId = newOrg.id;
            }
          }
        }

        // ── Part 1 fix: always write domain when Apollo provides it ──────────
        // The org-merge block above may not match by name if names diverge
        // slightly. This ensures domain is never left null when Apollo gives it.
        if (orgId && match.organization?.primary_domain) {
          await db.from("organizations")
            .update({
              domain: normalizeDomain(match.organization.primary_domain),
              ...(match.organization_id ? { apollo_org_id: match.organization_id } : {}),
              ...(match.organization.website_url ? { website: match.organization.website_url } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq("id", orgId)
            .is("domain", null); // only overwrite when domain is still missing

          // Fix A: sync affected leads — had no domain (input_required) → now has domain → new
          await db.from("leads")
            .update({ status: "new", updated_at: new Date().toISOString() })
            .eq("organization_id", orgId)
            .eq("status", "input_required")
            .eq("is_deleted", false)
            .not("email", "is", null);  // only if they also have email
        }

        if (orgId) enrichedOrgIds.add(orgId);

        await db.from("leads").update({
          last_name: match.last_name ?? null,
          email: match.email ?? null,
          email_status: match.email_status ?? null,
          headline: match.headline ?? null,
          linkedin_url: match.linkedin_url ?? null,
          city: match.city ?? null,
          state: match.state ?? null,
          country: match.country ?? null,
          time_zone: match.time_zone ?? null,
          email_domain_catchall: match.email_domain_catchall ?? null,
          seniority: match.seniority ?? null,
          departments: match.departments ?? null,
          is_likely_to_engage: match.is_likely_to_engage ?? null,
          organization_id: orgId,
          updated_at: new Date().toISOString(),
        }).eq("apollo_id", match.id);

        const crm = match.email_status === "verified" ? "enriched" : "skipped";
        await db.from("campaign_leads")
          .update({ crm_status: crm, updated_at: new Date().toISOString() })
          .eq("lead_id", lead.id);
      }
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    warning = status === 402
      ? `Credits exhausted after ${matched} matched`
      : (err as Error).message;
  }

  // Collect missing (still no email after enrichment)
  const allApolloIds = targets.map((t) => t.apollo_id);
  const { data: stillMissing } = await db
    .from("leads")
    .select("apollo_id")
    .in("apollo_id", allApolloIds)
    .is("email", null);
  missingApolloIds.push(...(stillMissing ?? []).map((r) => r.apollo_id));

  return {
    matched,
    verified,
    unverified,
    credits_consumed: totalCredits,
    missing_apollo_ids: missingApolloIds,
    enriched_org_ids: [...enrichedOrgIds],
    ...(warning ? { warning } : {}),
  };
}
