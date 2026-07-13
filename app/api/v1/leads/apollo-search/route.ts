import { NextRequest, after } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok } from "@/lib/api-response";
import { ApolloSearchSchema } from "@/lib/validators/leads";
import { searchPeople } from "@/lib/services/apollo";
import { type EnrichTarget } from "@/lib/services/enrich-leads";
import { internalAppBaseUrl } from "@/lib/internal-url";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let user: { id: string };
  try { user = await requireManager(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = ApolloSearchSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const { keywords, locations, max_pages, titles, seniorities, batch_name, color, preview } = parsed.data;

  if (!process.env.APOLLO_API_KEY) return fail(503, "UPSTREAM_APOLLO", "Apollo API key not configured");

  // ── Preview mode ──────────────────────────────────────────────────────────
  if (preview) {
    let previewPeople: Array<{ firstName: string; lastName: string; email: string; company: string; jobTitle: string }> = [];
    try {
      const result = await searchPeople({
        keyword: keywords[0],
        locations,
        page: 1,
        titles: titles ?? undefined,
        seniorities: seniorities ?? undefined,
      });
      previewPeople = (result.people ?? [])
        .filter((p) => p.has_email)
        .slice(0, 5)
        .map((p) => ({
          firstName: p.first_name ?? "",
          lastName: "",
          email: "••••@" + (p.organization?.name?.toLowerCase().replace(/\s+/g, "") ?? "company") + ".com",
          company: p.organization?.name ?? "",
          jobTitle: p.title ?? "",
        }));
    } catch {
      previewPeople = [];
    }
    return Response.json({ success: true, data: { preview: true, leads: previewPeople } });
  }

  // ── Phase 1: Search all keywords/pages, batch-insert leads ───────────────
  const db = createAdminClient();

  const { data: importRow } = await db.from("imports")
    .insert({ label: batch_name, source: "apollo", created_by: user.id, lead_count: 0, color })
    .select("id").single();
  const importId = importRow?.id ?? null;

  let totalEntries = 0;
  let inserted = 0;
  let skippedDuplicate = 0;
  let orgsCreated = 0;
  let orgsReused = 0;
  const warnings: string[] = [];
  const newLeadTargets: EnrichTarget[] = [];
  const newOrgIds: string[] = [];

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

      const people = result.people.filter((p) => p.has_email);
      if (people.length === 0) continue;

      // Batch dedup
      const apolloIds = people.map((p) => p.id);
      const { data: existing } = await db
        .from("leads").select("apollo_id").in("apollo_id", apolloIds);
      const existingSet = new Set((existing ?? []).map((r) => r.apollo_id));
      const newPeople = people.filter((p) => !existingSet.has(p.id));
      skippedDuplicate += people.length - newPeople.length;

      if (newPeople.length === 0) continue;

      // Batch org lookup
      const uniqueOrgNames = [...new Set(newPeople.map((p) => p.organization?.name ?? "Unknown"))];
      const orFilter = uniqueOrgNames.map((n) => `name.ilike.${n}`).join(",");
      const { data: existingOrgs } = await db
        .from("organizations").select("id, name").or(orFilter);
      const orgMap = new Map<string, string>();
      for (const org of existingOrgs ?? []) orgMap.set(org.name.toLowerCase(), org.id);
      orgsReused += orgMap.size;

      // Batch insert new orgs
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

      // Batch insert leads
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
          import_id: importId,
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

  if (importId && inserted > 0) {
    await db.from("imports").update({ lead_count: inserted }).eq("id", importId);
  }

  // Phase 1 complete — leads are now in the DB. Fire-and-forget Phase 2A
  // (email reveal) and Phase 2B (org scraping) so the client can redirect.
  const baseUrl = internalAppBaseUrl(req);
  const authHeader = req.headers.get("authorization") ?? "";

  if (importId && newLeadTargets.length > 0 && process.env.APOLLO_API_KEY) {
    after(() =>
      fetch(`${baseUrl}/api/v1/leads/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader },
        body: JSON.stringify({ import_id: importId }),
      }).catch(() => {})
    );
  }

  if (newOrgIds.length > 0) {
    await db.from("enrichment_logs").insert({
      source: "system",
      event: "SCRAPE_QUEUED",
      payload: { total_orgs: newOrgIds.length, org_ids: newOrgIds, triggered_by: "phase1_completion" },
    });
  }

  return ok({
    total_entries: totalEntries,
    inserted,
    skipped: skippedDuplicate,
    orgs_created: orgsCreated,
    orgs_reused: orgsReused,
    enrich_queued: newLeadTargets.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}
