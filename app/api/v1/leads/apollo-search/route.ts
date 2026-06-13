import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { ApolloSearchSchema } from "@/lib/validators/leads";
import { searchPeople } from "@/lib/services/apollo";
import { enrichLeads, type EnrichTarget, type EnrichLeadsResult } from "@/lib/services/enrich-leads";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = ApolloSearchSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const { keywords, locations, max_pages, titles, seniorities } = parsed.data;

  if (!process.env.APOLLO_API_KEY) return fail(503, "UPSTREAM_APOLLO", "Apollo API key not configured");

  const db = createAdminClient();

  // ── Phase 1: Search all keywords/pages, batch-insert leads ───────────────

  let totalEntries = 0;
  let inserted = 0;
  let skippedDuplicate = 0;
  let orgsCreated = 0;
  let orgsReused = 0;
  const warnings: string[] = [];
  const newLeadTargets: EnrichTarget[] = [];
  const newOrgIds: string[] = []; // all org IDs from Phase 1 inserts

  for (const keyword of keywords) {
    for (let page = 1; page <= max_pages; page++) {
      let result;
      try {
        result = await searchPeople({
          keyword, locations, page,
          titles: titles ?? undefined,
          seniorities: seniorities ?? undefined,
        });
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401) return fail(502, "UPSTREAM_APOLLO", "Invalid or non-master Apollo key");
        if (status === 422) return fail(502, "UPSTREAM_APOLLO", (err as Error).message);
        warnings.push(`[${keyword}] stopped at page ${page}: ${(err as Error).message}`);
        break;
      }

      if (page === 1) {
        totalEntries += result.total_entries;
        if (result.total_entries === 0) {
          warnings.push(`[${keyword}] no results — try removing location filter or changing keyword`);
          break;
        }
      }

      if (!result.people || result.people.length === 0) break;

      // Only process leads Apollo confirms has an email
      const people = result.people.filter((p) => p.has_email);
      if (people.length === 0) continue;

      // ── 1. Batch dedup ────────────────────────────────────────────────────
      const apolloIds = people.map((p) => p.id);
      const { data: existing } = await db
        .from("leads").select("apollo_id").in("apollo_id", apolloIds);
      const existingSet = new Set((existing ?? []).map((r) => r.apollo_id));
      const newPeople = people.filter((p) => !existingSet.has(p.id));
      skippedDuplicate += people.length - newPeople.length;

      if (newPeople.length === 0) continue;

      // ── 2. Batch org lookup ───────────────────────────────────────────────
      const uniqueOrgNames = [...new Set(newPeople.map((p) => p.organization?.name ?? "Unknown"))];
      const orFilter = uniqueOrgNames.map((n) => `name.ilike.${n}`).join(",");
      const { data: existingOrgs } = await db
        .from("organizations").select("id, name").or(orFilter);
      const orgMap = new Map<string, string>();
      for (const org of existingOrgs ?? []) orgMap.set(org.name.toLowerCase(), org.id);
      orgsReused += orgMap.size;

      // ── 3. Batch insert new orgs (with enrichment_stage='queued') ─────────
      const missingOrgNames = uniqueOrgNames.filter((n) => !orgMap.has(n.toLowerCase()));
      if (missingOrgNames.length > 0) {
        const { data: newOrgs } = await db
          .from("organizations")
          .insert(missingOrgNames.map((name) => ({
            name,
            enrichment_stage: "queued",
            enrichment_status: "SCRAPE_QUEUED",
            enrichment_attempts: 0,
            created_at: new Date().toISOString(),
          })))
          .select("id, name");
        for (const org of newOrgs ?? []) {
          orgMap.set(org.name.toLowerCase(), org.id);
          newOrgIds.push(org.id);
        }
        orgsCreated += newOrgs?.length ?? 0;
      }

      // ── 4. Batch insert leads ─────────────────────────────────────────────
      const leadsToInsert = newPeople.flatMap((person) => {
        const orgName = person.organization?.name ?? "Unknown";
        const orgId = orgMap.get(orgName.toLowerCase());
        if (!orgId) { warnings.push(`Org not found for "${orgName}"`); return []; }
        return [{
          apollo_id: person.id,
          first_name: person.first_name,
          title: person.title,
          has_email: person.has_email,
          organization_id: orgId,
          lead_source: "apollo",
          created_by: user.id,
          created_at: new Date().toISOString(),
        }];
      });

      if (leadsToInsert.length === 0) continue;

      const { data: insertedLeads, error: insertErr } = await db
        .from("leads")
        .upsert(leadsToInsert, { onConflict: "apollo_id", ignoreDuplicates: true })
        .select("id, apollo_id, organization_id");

      if (insertErr) { warnings.push(`Batch lead insert failed: ${insertErr.message}`); continue; }

      inserted += insertedLeads?.length ?? 0;

      for (const newLead of insertedLeads ?? []) {
        const person = newPeople.find((p) => p.id === newLead.apollo_id);
        if (person?.has_email) {
          newLeadTargets.push({
            id: newLead.id,
            apollo_id: person.id,
            first_name: person.first_name,
            organization_id: newLead.organization_id,
            org_name: person.organization?.name ?? null,
          });
        }
      }
    }
  }

  // ── Queue enrichment for all new orgs ─────────────────────────────────────
  if (newOrgIds.length > 0) {
    await db.from("enrichment_logs").insert({
      source: "system",
      event: "SCRAPE_QUEUED",
      payload: {
        total_orgs: newOrgIds.length,
        org_ids: newOrgIds,
        triggered_by: "phase1_completion",
      },
    });
  }

  // ── Phase 2A: Bulk-match all new leads (10 at a time) ────────────────────

  let enrichStats: EnrichLeadsResult = {
    matched: 0, verified: 0, unverified: 0,
    credits_consumed: 0, missing_apollo_ids: [],
    enriched_org_ids: [],
  };

  if (newLeadTargets.length > 0) {
    try {
      enrichStats = await enrichLeads(db, newLeadTargets, 10);
      if (enrichStats.warning) warnings.push(`Enrich: ${enrichStats.warning}`);
    } catch (e) {
      warnings.push(`Enrich failed: ${(e as Error).message}`);
    }
  }

  // ── Fire-and-forget Phase 2B: scrape queued orgs (do NOT await) ──────────
  // Use fetch instead of after() — more reliable in both dev and prod.
  // By the time the HTTP request is processed, Phase 2A has already filled
  // in domains, so scrape-orgs will find orgs with domains.
  if (newOrgIds.length > 0 && process.env.FIRECRAWL_API_KEY && process.env.INTERNAL_SECRET) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    fetch(`${baseUrl}/api/enrich/scrape-orgs`, {
      method: "POST",
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET },
    }).catch(() => { /* intentional fire-and-forget */ });
  }

  return ok({
    total_entries: totalEntries,
    inserted,
    skipped: skippedDuplicate,
    orgs_created: orgsCreated,
    orgs_reused: orgsReused,
    enriched: enrichStats.matched,
    verified: enrichStats.verified,
    credits_consumed: enrichStats.credits_consumed,
    missing_count: enrichStats.missing_apollo_ids.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}
