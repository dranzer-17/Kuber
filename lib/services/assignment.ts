import { createAdminClient } from "@/lib/supabase/admin";

// Territory is consulted only AT ASSIGNMENT TIME (review §5.4) — deliberately.
// If an employee's territory changes after leads were already routed to them,
// those existing leads are left alone; only future auto-assignments honor the
// new territory. Retroactively re-territorying an employee's whole book on
// every territory edit would silently move leads out from under whoever is
// actively working them, which is worse than the status quo.
type Db = ReturnType<typeof createAdminClient>;
export type Territory = "india" | "foreign";
export type AssignmentStrategy = "manual" | "round_robin" | "territory";

/**
 * Map a lead's country to a routing region:
 * india / foreign (rest of world). Null only when country is empty —
 * such leads are skipped by territory routing and stay in the manager pool.
 */
export function normalizeTerritory(country: string | null | undefined): Territory | null {
  const c = country?.trim().toLowerCase();
  if (!c) return null;
  if (c === "india") return "india";
  return "foreign";
}

type Candidate = { id: string; load: number };

/**
 * Employees ELIGIBLE for automatic assignment (spec §2B/§3): role=employee,
 * is_active=true, AND availability_status='online'. Deactivated users can't be
 * assigned at all; offline users are temporarily excluded from round-robin and
 * territory routing (but can still receive a manual assignment, with a warning).
 */
async function getEligibleEmployees(db: Db, territory?: Territory): Promise<string[]> {
  let query = db.from("profiles")
    .select("id")
    .eq("role", "employee")
    .eq("is_active", true)
    .eq("availability_status", "online");
  if (territory) query = query.eq("territory", territory);
  const { data } = await query.order("id");
  return (data ?? []).map((row) => row.id as string);
}

/** Workspace-level exclusion counts for assignment summaries (spec §3 response). */
async function getExclusionCounts(db: Db): Promise<{ excluded_offline: number; excluded_deactivated: number }> {
  const [{ count: offline }, { count: deactivated }] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true })
      .eq("role", "employee").eq("is_active", true).eq("availability_status", "offline"),
    db.from("profiles").select("id", { count: "exact", head: true })
      .eq("role", "employee").eq("is_active", false),
  ]);
  return { excluded_offline: offline ?? 0, excluded_deactivated: deactivated ?? 0 };
}

/** Current live-lead count per employee — the fairness signal for round-robin picks. */
async function getLeadLoads(db: Db, employeeIds: string[]): Promise<Map<string, number>> {
  const loads = new Map<string, number>(employeeIds.map((id) => [id, 0]));
  if (employeeIds.length === 0) return loads;
  const { data } = await db
    .from("leads")
    .select("assigned_to")
    .in("assigned_to", employeeIds)
    .eq("is_deleted", false);
  for (const row of data ?? []) {
    const id = row.assigned_to as string;
    loads.set(id, (loads.get(id) ?? 0) + 1);
  }
  return loads;
}

/**
 * Current live-lead count per employee, scoped to ONE region (review §3.7).
 * A global count would let an employee's unrelated cross-territory
 * assignments (e.g. manually-assigned leads from another region) skew how
 * many NEW leads of THIS region they get next — scoping to the region being
 * routed keeps territory fairness meaningful ("how many India leads does
 * this India rep already have", not "how many leads total").
 */
async function getTerritoryScopedLoads(db: Db, employeeIds: string[], territory: Territory): Promise<Map<string, number>> {
  const loads = new Map<string, number>(employeeIds.map((id) => [id, 0]));
  if (employeeIds.length === 0) return loads;
  const { data } = await db
    .from("leads")
    .select("assigned_to, country")
    .in("assigned_to", employeeIds)
    .eq("is_deleted", false);
  for (const row of data ?? []) {
    if (normalizeTerritory(row.country as string | null) !== territory) continue;
    const id = row.assigned_to as string;
    loads.set(id, (loads.get(id) ?? 0) + 1);
  }
  return loads;
}

/**
 * Candidates for a region (active + online reps in that territory):
 *   india   → india reps only (no sensible fallback — pool if none)
 *   foreign → foreign (rest-of-world) reps only
 */
async function candidatesForRegion(db: Db, region: Territory): Promise<string[]> {
  return getEligibleEmployees(db, region);
}

/**
 * Stateful picker for a bulk action: least-loaded first, round-robin cursor as
 * the tiebreak. Loads are fetched once and incremented locally so a 500-lead
 * import doesn't issue 500 count queries.
 */
class LoadBalancedPicker {
  private loads: Map<string, number>;
  private rrIndex = 0;

  constructor(loads: Map<string, number>) {
    this.loads = loads;
  }

  static async create(db: Db): Promise<LoadBalancedPicker> {
    const all = await getEligibleEmployees(db);
    return new LoadBalancedPicker(await getLeadLoads(db, all));
  }

  pick(candidateIds: string[]): string | null {
    if (candidateIds.length === 0) return null;
    const ranked: Candidate[] = candidateIds.map((id) => ({ id, load: this.loads.get(id) ?? 0 }));
    const minLoad = Math.min(...ranked.map((c) => c.load));
    const tied = ranked.filter((c) => c.load === minLoad);
    const chosen = tied[this.rrIndex % tied.length];
    this.rrIndex++;
    this.loads.set(chosen.id, chosen.load + 1);
    return chosen.id;
  }
}

/** Rich result summary for a bulk assignment (spec §3/§4). */
export type AssignmentSummary = {
  total: number;                    // leads processed
  newly_assigned: number;           // were unassigned (pool), now assigned
  reassigned: number;               // were assigned to someone else, now moved
  skipped_already_assigned: number; // left untouched because they were already assigned
  unmatched: number;                // territory/RR: no eligible employee (or no country) → left in pool
  eligible_employee_count: number;  // distinct eligible employees available for this run
  excluded_offline: number;         // active employees skipped for being offline
  excluded_deactivated: number;     // deactivated employees (never eligible)
  manual_target_offline: boolean;   // manual: chosen target is offline (allowed, but warned)
};

/**
 * Assigns a specific set of leads under an explicitly-chosen strategy (the
 * bulk "Assign" action on the Leads page, or the picker on Apollo/Excel
 * imports). Returns a full summary (spec §3).
 *
 * - "manual": every eligible lead goes to `assignedTo` (or the pool when null).
 *   A deactivated target is rejected upstream; an offline target is allowed but
 *   flagged (`manual_target_offline`).
 * - "round_robin": distributed least-loaded first across all ELIGIBLE (active +
 *   online) employees.
 * - "territory": each region gets its own least-loaded picker seeded with
 *   region-scoped loads (review §3.7); a lead whose region has no eligible rep,
 *   or no country at all, is left unmatched in the pool.
 *
 * When `skipAlreadyAssigned` is true, any lead that already has an owner is
 * left completely untouched (spec §4) — the safeguard against silently
 * yanking a lead out from under whoever is working it.
 */
export async function bulkAssignByStrategy(
  db: Db,
  leadIds: string[],
  strategy: AssignmentStrategy,
  assignedTo: string | null,
  skipAlreadyAssigned = false,
): Promise<AssignmentSummary> {
  const now = new Date().toISOString();

  const { data: leads } = await db.from("leads").select("id, country, assigned_to").in("id", leadIds);
  const rows = leads ?? [];
  const exclusions = await getExclusionCounts(db);

  const summary: AssignmentSummary = {
    total: rows.length,
    newly_assigned: 0,
    reassigned: 0,
    skipped_already_assigned: 0,
    unmatched: 0,
    eligible_employee_count: 0,
    excluded_offline: exclusions.excluded_offline,
    excluded_deactivated: exclusions.excluded_deactivated,
    manual_target_offline: false,
  };

  // Records one lead move and updates the summary tallies.
  async function applyAssignment(leadId: string, prior: string | null, next: string | null) {
    await db.from("leads").update({ assigned_to: next, assigned_at: next ? now : null }).eq("id", leadId);
    if (next && !prior) summary.newly_assigned++;
    else if (next && prior && prior !== next) summary.reassigned++;
  }

  if (strategy === "manual") {
    if (assignedTo) {
      const { data: target } = await db
        .from("profiles")
        .select("id, is_active, availability_status")
        .eq("id", assignedTo)
        .maybeSingle();
      if (!target || !target.is_active) throw new Error("Employee not found or inactive");
      summary.manual_target_offline = target.availability_status === "offline";
      summary.eligible_employee_count = 1;
    }
    for (const lead of rows) {
      const prior = (lead.assigned_to as string | null) ?? null;
      if (skipAlreadyAssigned && prior) { summary.skipped_already_assigned++; continue; }
      if (prior === assignedTo) { summary.skipped_already_assigned++; continue; } // already theirs
      await applyAssignment(lead.id, prior, assignedTo);
    }
    return summary;
  }

  if (strategy === "territory") {
    const candidatesByRegion = new Map<Territory, string[]>();
    const pickersByRegion = new Map<Territory, LoadBalancedPicker>();
    const usedEmployees = new Set<string>();

    for (const lead of rows) {
      const prior = (lead.assigned_to as string | null) ?? null;
      if (skipAlreadyAssigned && prior) { summary.skipped_already_assigned++; continue; }

      const region = normalizeTerritory(lead.country as string | null);
      if (!region) { summary.unmatched++; continue; }

      if (!candidatesByRegion.has(region)) {
        candidatesByRegion.set(region, await candidatesForRegion(db, region));
      }
      const candidates = candidatesByRegion.get(region)!;
      if (!pickersByRegion.has(region)) {
        pickersByRegion.set(region, new LoadBalancedPicker(await getTerritoryScopedLoads(db, candidates, region)));
      }
      const assigneeId = pickersByRegion.get(region)!.pick(candidates);
      if (!assigneeId) { summary.unmatched++; continue; }
      usedEmployees.add(assigneeId);
      await applyAssignment(lead.id, prior, assigneeId);
    }
    summary.eligible_employee_count = usedEmployees.size;
    return summary;
  }

  // round_robin: one global least-loaded picker across all eligible employees.
  const candidates = await getEligibleEmployees(db);
  summary.eligible_employee_count = candidates.length;
  const picker = await LoadBalancedPicker.create(db);
  for (const lead of rows) {
    const prior = (lead.assigned_to as string | null) ?? null;
    if (skipAlreadyAssigned && prior) { summary.skipped_already_assigned++; continue; }
    const assigneeId = picker.pick(candidates);
    if (!assigneeId) { summary.unmatched++; continue; }
    await applyAssignment(lead.id, prior, assigneeId);
  }
  return summary;
}

/** Resolves who a newly-enriched lead should auto-assign to, or null to leave it in the Manager's pool. */
export async function resolveAssignee(db: Db, leadCountry: string | null | undefined): Promise<string | null> {
  const { data: settings } = await db
    .from("assignment_settings")
    .select("strategy")
    .limit(1)
    .maybeSingle();

  if (!settings || settings.strategy === "manual") return null;

  if (settings.strategy === "territory") {
    const region = normalizeTerritory(leadCountry);
    if (!region) return null;
    const candidates = await candidatesForRegion(db, region);
    if (candidates.length === 0) return null;
    // Region-scoped load (review §3.7) so leads trickling in one at a time
    // still alternate fairly between same-region reps.
    const loads = await getTerritoryScopedLoads(db, candidates, region);
    return new LoadBalancedPicker(loads).pick(candidates);
  }

  const candidates = await getEligibleEmployees(db);
  if (candidates.length === 0) return null;
  const loads = await getLeadLoads(db, candidates);
  return new LoadBalancedPicker(loads).pick(candidates);
}

/**
 * Auto-assigns still-unassigned leads under an org once they are ready to work —
 * that is, either fully enriched OR input_required (the company had no usable
 * website / enrichment failed, but the lead has an email and can be worked with
 * the generic template). New/enriching leads are intentionally left in the pool.
 */
export async function autoAssignEnrichedLeads(db: Db, orgId: string): Promise<void> {
  const { data: leads } = await db
    .from("leads")
    .select("id, country")
    .eq("organization_id", orgId)
    .eq("is_deleted", false)
    .in("status", ["enriched", "input_required"])
    .is("assigned_to", null);

  for (const lead of leads ?? []) {
    const assigneeId = await resolveAssignee(db, lead.country as string | null);
    if (!assigneeId) continue;
    await db
      .from("leads")
      .update({ assigned_to: assigneeId, assigned_at: new Date().toISOString() })
      .eq("id", lead.id);
  }
}
