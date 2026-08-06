import { NextRequest, after } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { fail, ok } from "@/lib/api-response";
import { ApolloSearchSchema } from "@/lib/validators/leads";
import { searchPeople } from "@/lib/services/apollo";
import { getServiceSecret } from "@/lib/services/service-keys";
import { resolveApolloKeyword } from "@/lib/constants";
// Only used here for counting/ids (the actual enrich pass re-queries its own
// full target shape) — deliberately a narrower local type, not EnrichTarget.
type NewLeadTarget = { id: string; apollo_id: string; first_name: string | null; organization_id: string | null; org_name: string | null };
import { internalAppBaseUrl } from "@/lib/internal-url";
import { dbForUser } from "@/lib/supabase/scoped";
import { DEV_COMPANY_ID } from "@/lib/constants";
import { checkApolloCredits } from "@/lib/services/provider-credits";

export const maxDuration = 300;

/** What searchPeople() asks Apollo for per page (its own per_page default). */
const APOLLO_LEADS_PER_PAGE = 100;

/**
 * Paging is cap-driven, not count-driven: keep walking a keyword's result pages
 * until its lead cap is met. A fixed page count used to be a user-facing
 * dropdown, which was a trap — a page returns 100 raw people, but has_email +
 * already-imported + already-archived filtering can leave only a handful, so
 * "1 page" silently delivered a fraction of the cap the manager actually asked
 * for, and got worse on every re-import of the same niche. Apollo's SEARCH
 * endpoint costs no lead credits (only people/bulk_match does), so digging
 * deeper is free — the caps below are what bound real spend.
 *
 * The three stop conditions that keep "keep paging" from meaning "page forever":
 *  1. Apollo's own total_entries (known after page 1) — never page past the end.
 *  2. MAX_PAGES_PER_KEYWORD — a wall-clock seatbelt. Each page is an Apollo
 *     round trip plus two dedup queries plus an insert; on a 95%-duplicate
 *     niche an uncapped hunt would blow the 300s function limit and get killed
 *     mid-import, leaving a half-written batch.
 *  3. MAX_BARREN_PAGES — consecutive pages yielding zero new leads mean the
 *     vein is mined out; stop rather than grind to the ceiling.
 */
const MAX_PAGES_PER_KEYWORD = 10;
const MAX_BARREN_PAGES = 3;

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireManager>>;
  try { user = await requireManager(req); } catch (r) { return r as Response; }

  // provider_keys (Apollo included) are shared across every company — a
  // search here spends real credits from the one pool the live client
  // account also draws from. The dev/internal workspace has no business
  // case for Apollo search, so it's blocked outright rather than trusted
  // not to run one "just to test."
  if (user.companyId === DEV_COMPANY_ID) {
    return fail(403, "APOLLO_DISABLED_DEV", "Apollo search is disabled for the internal/dev workspace — Apollo credits are shared with the live client account.");
  }

  const body = await req.json().catch(() => null);
  const parsed = ApolloSearchSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const { keywords, locations, titles, seniorities, batch_name, color, preview, assigned_to, assignment_strategy, max_leads_per_keyword } = parsed.data;
  // Mutable: clamped down (never up) to Apollo's real remaining balance below,
  // once we have a DB client to check it with.
  let maxTotalLeads = parsed.data.max_total_leads;

  // Resolve through Settings > Keys (DB first, .env as the last-resort tier) —
  // the same path searchPeople() itself uses. Checking process.env directly
  // here 503'd every deployment that stores its key in the UI instead of an
  // env var (i.e. production), even with a healthy Apollo key configured.
  const apolloKey = await getServiceSecret("apollo");
  if (!apolloKey) return fail(503, "UPSTREAM_APOLLO", "Apollo API key not configured — add one in Settings > Keys");

  // ── Preview mode ──────────────────────────────────────────────────────────
  if (preview) {
    let previewPeople: Array<{ firstName: string; lastName: string; email: string; company: string; jobTitle: string }> = [];
    try {
      const result = await searchPeople({
        keyword: resolveApolloKeyword(keywords[0]),
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
  const db = dbForUser(user);

  // Never request more than Apollo can actually pay for — if only 40 credits
  // are left, this import gets clamped to 40, not attempted at 50 and left
  // to fail (and archive-loop) partway through.
  const apolloCredits = await checkApolloCredits(db);
  if (apolloCredits.remaining != null && apolloCredits.remaining < maxTotalLeads) {
    maxTotalLeads = Math.max(0, apolloCredits.remaining);
  }
  if (maxTotalLeads <= 0) {
    return fail(402, "APOLLO_OUT_OF_CREDITS", "Apollo has no lead credits remaining — top up before importing.");
  }

  if (assigned_to) {
    const { data: employee } = await db.from("profiles").select("id, is_active").eq("id", assigned_to).maybeSingle();
    if (!employee || !employee.is_active) return fail(400, "INVALID_ASSIGNEE", "Employee not found or inactive");
  }

  // Deferred assignment (planning.md Phase 4 / Q5): DON'T assign at import time,
  // when leads are raw "New" shells with no confirmed email. Remember the
  // manager's choice on the import; autoAssignEnrichedLeads applies it per-lead
  // the moment each lead becomes workable (enriched / input_required-with-email)
  // — after the paid Apollo email-reveal, never before it.
  const importAssignmentStrategy = assigned_to ? "manual" : (assignment_strategy ?? null);
  const importAssignmentTarget = assigned_to ?? null;

  const { data: importRow } = await db.from("imports")
    .insert({
      label: batch_name, source: "apollo", created_by: user.id, lead_count: 0, color,
      assignment_strategy: importAssignmentStrategy,
      assignment_target: importAssignmentTarget,
    })
    .select("id").single();
  const importId = importRow?.id ?? null;

  let totalEntries = 0;
  let inserted = 0;
  let skippedDuplicate = 0;
  let skippedUnenrichable = 0;
  let orgsCreated = 0;
  let orgsReused = 0;
  const warnings: string[] = [];
  const newLeadTargets: NewLeadTarget[] = [];
  const newOrgIds: string[] = [];
  // WHO already owns each duplicate — previously a second importer just saw
  // "skipped" with no clue the lead already belongs to someone else (review
  // §3.3), capped to a reasonable sample for the response.
  const DUPLICATE_SAMPLE_CAP = 50;
  const duplicateOwners: Array<{ name: string; company: string; assigned_to: string | null }> = [];

  // Dropdown labels (e.g. "Beverage Bottles (Water/Juice/CSD)") are display
  // text, not Apollo query terms — Apollo's q_keywords matches near-literally
  // and returns 0 results for punctuation-heavy phrases, so resolve to the
  // validated short term (lib/constants.ts) and dedup so two labels that
  // resolve to the same query don't search Apollo twice.
  const resolvedKeywords = [...new Map(keywords.map((label) => [resolveApolloKeyword(label), label])).entries()]
    .map(([query, label]) => ({ query, label }));

  // Every lead inserted below eventually costs a paid Apollo bulk_match call —
  // max_total_leads and max_leads_per_keyword are the ONLY credit-spend
  // ceilings for this import (lib/validators/leads.ts ApolloSearchSchema), and
  // now also the thing that decides when to stop paging.
  let overallCapHit = false;

  for (const [keywordIndex, { query, label }] of resolvedKeywords.entries()) {
    if (overallCapHit) break;

    // FAIR SHARE. Keywords used to run first-come-first-served against a single
    // shared cap, so the first one simply ate the import: asking for 50 leads
    // across 9 industry segments returned 50 from segment one and nothing at all
    // from the eight the manager had deliberately ticked.
    //
    // Each keyword now gets an even slice of whatever budget is LEFT, recomputed
    // per keyword — which is what rolls unspent slots forward automatically. If
    // one segment is thin and yields 2 of its 6, the remaining keywords each get
    // a slightly larger share and the import still finishes at the cap.
    // max_leads_per_keyword stays on top as the per-keyword safety ceiling.
    const keywordsLeft = resolvedKeywords.length - keywordIndex;
    const budgetLeft = maxTotalLeads - inserted;
    if (budgetLeft <= 0) break;
    const keywordBudget = Math.min(Math.ceil(budgetLeft / keywordsLeft), max_leads_per_keyword);

    let keywordInserted = 0;
    // Consecutive pages that produced no new leads (all duplicates / no email).
    let barrenPages = 0;
    // Tightened to Apollo's real result count once page 1 tells us what it is.
    let pageCeiling = MAX_PAGES_PER_KEYWORD;

    for (let page = 1; page <= pageCeiling; page++) {
      if (overallCapHit || keywordInserted >= keywordBudget) break;
      if (barrenPages >= MAX_BARREN_PAGES) {
        warnings.push(`[${label}] stopped after ${MAX_BARREN_PAGES} pages with no new leads — got ${keywordInserted} of ${keywordBudget}`);
        break;
      }
      let result;
      try {
        result = await searchPeople({
          keyword: query, locations, page,
          titles: titles ?? undefined,
          seniorities: seniorities ?? undefined,
        });
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401) return fail(502, "UPSTREAM_APOLLO", "Invalid or non-master Apollo key");
        if (status === 422) return fail(502, "UPSTREAM_APOLLO", (err as Error).message);
        warnings.push(`[${label}] stopped at page ${page}: ${(err as Error).message}`);
        break;
      }

      if (page === 1) {
        totalEntries += result.total_entries;
        if (result.total_entries === 0) {
          warnings.push(`[${label}] no results — try removing location filter or changing keyword`);
          break;
        }
        // Stop condition 1: Apollo cannot give us more than it has. Without
        // this, a keyword with 250 results and a 100-lead cap would keep
        // requesting empty pages up to the seatbelt.
        pageCeiling = Math.min(MAX_PAGES_PER_KEYWORD, Math.ceil(result.total_entries / APOLLO_LEADS_PER_PAGE));
      }

      if (!result.people || result.people.length === 0) break;

      const people = result.people.filter((p) => p.has_email);
      if (people.length === 0) { barrenPages++; continue; }

      // Batch dedup
      const apolloIds = people.map((p) => p.id);
      const { data: existing } = await db
        .from("leads").select("apollo_id, assigned_to").in("apollo_id", apolloIds);
      const existingOwners = new Map((existing ?? []).map((r) => [r.apollo_id, r.assigned_to as string | null]));
      let newPeople = people.filter((p) => !existingOwners.has(p.id));
      skippedDuplicate += people.length - newPeople.length;
      for (const p of people) {
        if (existingOwners.has(p.id) && duplicateOwners.length < DUPLICATE_SAMPLE_CAP) {
          duplicateOwners.push({
            name: p.first_name || "Unknown",
            company: p.organization?.name ?? "Unknown",
            assigned_to: existingOwners.get(p.id) ?? null,
          });
        }
      }

      // Don't re-add someone we already asked Apollo about and got no email
      // for — that answer doesn't change, so re-inserting them just re-runs
      // the same doomed (and now try-once) email-reveal for a person already
      // parked in the disconnected archive table.
      if (newPeople.length > 0) {
        const { data: alreadyArchived } = await db
          .from("unenrichable_leads").select("apollo_id").in("apollo_id", newPeople.map((p) => p.id));
        const archivedIds = new Set((alreadyArchived ?? []).map((r) => r.apollo_id));
        if (archivedIds.size > 0) {
          skippedUnenrichable += archivedIds.size;
          newPeople = newPeople.filter((p) => !archivedIds.has(p.id));
        }
      }

      if (newPeople.length === 0) { barrenPages++; continue; }

      // Trim to whatever's left of the per-keyword and overall caps so we
      // never insert (and later pay Apollo to reveal) more than requested,
      // even mid-page.
      const roomForKeyword = keywordBudget - keywordInserted;
      const roomOverall = maxTotalLeads - inserted;
      const room = Math.min(roomForKeyword, roomOverall);
      if (room <= 0) break;
      if (newPeople.length > room) {
        if (roomOverall <= roomForKeyword) {
          warnings.push(`Import cap of ${maxTotalLeads} leads reached — stopped partway through "${label}"`);
        }
        newPeople = newPeople.slice(0, room);
      }

      // Batch org lookup.
      // PostgREST's or= list is comma-separated, so an unquoted company name
      // containing a comma or parenthesis — "Reliance Industries, Ltd" — splits
      // the filter into garbage. The query then errors, `data` comes back null,
      // orgMap is empty, and EVERY org on the page is treated as new: that is
      // how the database ended up with more organisations than it has real
      // companies. Double-quote each value and escape what PostgREST reserves.
      const uniqueOrgNames = [...new Set(newPeople.map((p) => p.organization?.name ?? "Unknown"))];
      const orFilter = uniqueOrgNames
        .map((n) => `name.ilike."${n.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(",");
      const { data: existingOrgs, error: orgLookupError } = await db
        .from("organizations").select("id, name").or(orFilter);
      if (orgLookupError) {
        // Fail loud rather than silently duplicating every org on the page.
        warnings.push(`Org lookup failed for one page: ${orgLookupError.message}`);
      }
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
          city: person.city ?? null,
          state: person.state ?? null,
          country: person.country ?? null,
          organization_id: orgId,
          lead_source: "apollo",
          created_by: user.id,
          import_id: importId,
          // Deferred assignment: leads land unassigned. The import's stored
          // choice is applied by autoAssignEnrichedLeads once each lead is
          // workable — never here, while it's still a raw "New" shell.
          assigned_to: null,
          assigned_at: null,
          created_at: new Date().toISOString(),
        }];
      });

      if (leadsToInsert.length === 0) { barrenPages++; continue; }

      const { data: insertedLeads, error: insertErr } = await db
        .from("leads")
        .upsert(leadsToInsert, { onConflict: "apollo_id", ignoreDuplicates: true })
        .select("id, apollo_id, organization_id");

      if (insertErr) { warnings.push(`Batch lead insert failed: ${insertErr.message}`); barrenPages++; continue; }

      const insertedThisPage = insertedLeads?.length ?? 0;
      inserted += insertedThisPage;
      keywordInserted += insertedThisPage;
      // A page can still land zero rows here — the upsert ignores conflicts, so
      // anyone inserted by a concurrent import between the dedup query above
      // and this write drops out silently.
      if (insertedThisPage === 0) barrenPages++; else barrenPages = 0;
      if (inserted >= maxTotalLeads) overallCapHit = true;

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

  // Assignment is deferred to autoAssignEnrichedLeads (runs per-lead once each
  // is workable, after email-reveal) — nothing is assigned at import time.
  const assignmentSkipped = 0;

  // Seed the activity timeline for every new lead.
  if (newLeadTargets.length > 0) {
    const { logLeadEvents } = await import("@/lib/services/lead-events");
    await logLeadEvents(db, newLeadTargets.map((t) => ({
      leadId: t.id, event: "created" as const, detail: "Imported from Apollo", actorId: user.id,
    })));
  }

  // Phase 1 complete — leads are now in the DB. Fire-and-forget Phase 2A
  // (email reveal) and Phase 2B (org scraping) so the client can redirect.
  const baseUrl = internalAppBaseUrl(req);
  const authHeader = req.headers.get("authorization") ?? "";

  if (importId && newLeadTargets.length > 0 && apolloKey) {
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
    skipped_unenrichable: skippedUnenrichable,
    orgs_created: orgsCreated,
    orgs_reused: orgsReused,
    enrich_queued: newLeadTargets.length,
    assignment_skipped: assignmentSkipped,
    duplicate_owners: duplicateOwners,
    // Lets the UI explain "you asked for 50 but only got 40" when Apollo's
    // real balance was lower than the requested cap.
    apollo_credits_remaining: apolloCredits.remaining,
    effective_max_total_leads: maxTotalLeads,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}
