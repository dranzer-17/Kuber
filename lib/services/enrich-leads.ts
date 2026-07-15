import type { SupabaseClient } from "@supabase/supabase-js";
import { bulkMatch } from "@/lib/services/apollo";
import { sleep } from "@/lib/http";
import { normalizeDomain } from "@/lib/utils/domain";

export interface EnrichLeadsResult {
  matched: number;
  verified: number;
  unverified: number;
  archived: number;
  credits_consumed: number;
  missing_apollo_ids: string[];
  enriched_org_ids: string[];
  warning?: string;
}

export interface EnrichTarget {
  id: string;          // DB lead UUID
  apollo_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  country: string | null;
  city: string | null;
  state: string | null;
  organization_id: string | null;
  org_name: string | null;
}

// Apollo charges a credit for a bulk_match call EVEN when it comes back
// "unavailable" — confirmed live (see conversation) — and that answer never
// changes on a re-ask (it's Apollo's own data gap, not a transient failure
// like a slow website). So email-reveal is try-once: anyone Apollo doesn't
// hand back a real email for gets archived into `unenrichable_leads` (a flat
// table with no foreign keys into the working schema — never shown in the
// app, never asked about again) and removed from `leads` immediately, instead
// of lingering as "has_email=true, email=null" to be re-charged on every
// future enrichment pass.
async function archiveUnenrichableLead(
  db: SupabaseClient,
  target: EnrichTarget,
  linkedinUrl?: string | null,
): Promise<void> {
  await db.from("unenrichable_leads").upsert({
    apollo_id: target.apollo_id,
    first_name: target.first_name,
    last_name: target.last_name,
    title: target.title,
    organization_name: target.org_name,
    country: target.country,
    city: target.city,
    state: target.state,
    linkedin_url: linkedinUrl ?? null,
  }, { onConflict: "apollo_id", ignoreDuplicates: true });

  await db.from("leads").delete().eq("id", target.id);

  // This was the org's only lead — an empty company record is just clutter
  // (and would otherwise sit around getting queued/rescraped for nobody).
  if (target.organization_id) {
    const { count } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", target.organization_id)
      .eq("is_deleted", false);
    if ((count ?? 0) === 0) {
      await db.from("organizations").delete().eq("id", target.organization_id);
    }
  }
}

export async function enrichLeads(
  db: SupabaseClient,
  targets: EnrichTarget[],
  chunkSize = 10,
  onProgress?: (processed: number, total: number) => void,
): Promise<EnrichLeadsResult> {
  let matched = 0;
  let verified = 0;
  let unverified = 0;
  let archived = 0;
  let totalCredits = 0;
  let processedCount = 0;
  const missingApolloIds: string[] = [];
  const enrichedOrgIds = new Set<string>();
  // Every org this run touched — used to conclude the pipeline afterwards so
  // no lead is left showing "New" forever (planning.md Phase 3.2).
  const touchedOrgIds = new Set<string>(
    targets.map((t) => t.organization_id).filter(Boolean) as string[],
  );
  let warning: string | undefined;

  try {
    for (let i = 0; i < targets.length; i += chunkSize) {
      const chunkTargets = targets.slice(i, i + chunkSize);
      const chunkDetails = chunkTargets.map((t) => ({
        id: t.apollo_id,
        first_name: t.first_name ?? undefined,
        organization_name: t.org_name ?? undefined,
      }));

      const result = await bulkMatch(chunkDetails);
      totalCredits += result.credits_consumed ?? 0;

      const seenApolloIds = new Set<string>();

      for (const match of result.matches ?? []) {
        const lead = chunkTargets.find((t) => t.apollo_id === match.id);
        if (!lead) continue;
        seenApolloIds.add(match.id);

        if (match.email == null) {
          // Apollo acknowledged the person but has no email on file — final
          // answer, archive now rather than leave it to be re-asked (and
          // re-charged) on every future run.
          await archiveUnenrichableLead(db, lead, match.linkedin_url);
          archived++;
          continue;
        }

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
              domain_source: match.organization.primary_domain ? "apollo" : undefined,
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
                domain_source: match.organization.primary_domain ? "apollo" : undefined,
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
                domain_source: match.organization.primary_domain ? "apollo" : null,
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

        if (orgId && match.organization?.primary_domain) {
          await db.from("organizations")
            .update({
              domain: normalizeDomain(match.organization.primary_domain),
              domain_source: "apollo",
              ...(match.organization_id ? { apollo_org_id: match.organization_id } : {}),
              ...(match.organization.website_url ? { website: match.organization.website_url } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq("id", orgId)
            .is("domain", null);

          await db.from("leads")
            .update({ status: "new", updated_at: new Date().toISOString() })
            .eq("organization_id", orgId)
            .eq("status", "input_required")
            .eq("is_deleted", false)
            .not("email", "is", null);
        }

        if (orgId) {
          enrichedOrgIds.add(orgId);
          touchedOrgIds.add(orgId);
        }

        // Only overwrite fields the match actually returned. A partial Apollo re-match
        // must NOT erase previously-good values with null (§3.1).
        const leadUpdate: Record<string, unknown> = {
          organization_id: orgId,
          updated_at: new Date().toISOString(),
        };
        if (match.last_name != null) leadUpdate.last_name = match.last_name;
        if (match.email != null) leadUpdate.email = match.email.toLowerCase();
        if (match.email_status != null) leadUpdate.email_status = match.email_status;
        if (match.headline != null) leadUpdate.headline = match.headline;
        if (match.linkedin_url != null) leadUpdate.linkedin_url = match.linkedin_url;
        if (match.city != null) leadUpdate.city = match.city;
        if (match.state != null) leadUpdate.state = match.state;
        if (match.country != null) leadUpdate.country = match.country;
        if (match.time_zone != null) leadUpdate.time_zone = match.time_zone;
        if (match.email_domain_catchall != null) leadUpdate.email_domain_catchall = match.email_domain_catchall;
        if (match.seniority != null) leadUpdate.seniority = match.seniority;
        if (match.departments != null) leadUpdate.departments = match.departments;
        if (match.is_likely_to_engage != null) leadUpdate.is_likely_to_engage = match.is_likely_to_engage;
        await db.from("leads").update(leadUpdate).eq("apollo_id", match.id);

        // Only reset the CRM status of leads still in a pre-send stage — never clobber
        // a lead that's already sent/replied/won in another campaign (§3.1).
        const crm = match.email_status === "verified" ? "enriched" : "skipped";
        await db.from("campaign_leads")
          .update({ crm_status: crm, updated_at: new Date().toISOString() })
          .eq("lead_id", lead.id)
          .in("crm_status", ["new", "enriching", "enriched", "skipped"]);
      }

      // Targets Apollo didn't return a record for at all — same final "no
      // email, ever" outcome as an explicit null-email match, so archive them.
      for (const target of chunkTargets) {
        if (!seenApolloIds.has(target.apollo_id)) {
          await archiveUnenrichableLead(db, target);
          archived++;
        }
      }

      processedCount += chunkTargets.length;
      onProgress?.(processedCount, targets.length);

      if (i + chunkSize < targets.length) await sleep(500);
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    warning = status === 402
      ? `Credits exhausted after ${matched} matched`
      : (err as Error).message;
  }

  // ── Conclude the pipeline for every touched org (planning.md Phase 3.2) ────
  // "New" now means "enrichment in flight", so a bulk-match run must leave no
  // org dangling: revive previously-failed orgs that just gained a domain
  // (they'll be scraped), and mark still-domainless orgs failed so their
  // leads move to Input Required instead of sitting in New forever. Orgs
  // deleted above (their only lead just got archived) are simply no-ops here.
  if (touchedOrgIds.size > 0) {
    const ids = [...touchedOrgIds];
    const now = new Date().toISOString();

    await db.from("organizations")
      .update({
        enrichment_stage: "queued",
        enrichment_status: "SCRAPE_QUEUED",
        last_error: null,
        updated_at: now,
      })
      .in("id", ids)
      .eq("enrichment_stage", "failed")
      .not("domain", "is", null)
      .or("enrichment_attempts.is.null,enrichment_attempts.lt.3");

    await db.from("organizations")
      .update({
        enrichment_stage: "failed",
        enrichment_status: "No website found",
        enrichment_done_at: now,
        updated_at: now,
      })
      .in("id", ids)
      .is("domain", null)
      .in("enrichment_stage", ["queued", "scraping"]);
  }

  // Collect missing (still no email after enrichment) — should stay empty in
  // practice now that unresolved targets are archived+removed above; kept as
  // a defensive check in case a target somehow survived without resolution.
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
    archived,
    credits_consumed: totalCredits,
    missing_apollo_ids: missingApolloIds,
    enriched_org_ids: [...enrichedOrgIds],
    ...(warning ? { warning } : {}),
  };
}
