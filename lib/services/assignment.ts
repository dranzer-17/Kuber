import { createAdminClient } from "@/lib/supabase/admin";

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

async function getActiveEmployees(db: Db, territory?: Territory): Promise<string[]> {
  let query = db.from("profiles").select("id").eq("role", "employee").eq("is_active", true);
  if (territory) query = query.eq("territory", territory);
  const { data } = await query.order("id");
  return (data ?? []).map((row) => row.id as string);
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
 * Candidates for a region:
 *   india   → india reps only (no sensible fallback — pool if none)
 *   foreign → foreign (rest-of-world) reps only
 */
async function candidatesForRegion(db: Db, region: Territory): Promise<string[]> {
  return getActiveEmployees(db, region);
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
    const all = await getActiveEmployees(db);
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

/**
 * Assigns a specific set of leads under an explicitly-chosen strategy (the
 * bulk "Assign" action on the Leads page, or the picker on Apollo/Excel
 * imports). For "manual", every lead goes to `assignedTo` (or the pool when
 * null). For "round_robin", leads are distributed least-loaded first across
 * ALL active employees (a genuinely company-wide, not territory-scoped,
 * fairness signal). For "territory", each region gets its OWN least-loaded
 * picker seeded with region-scoped loads (review §3.7) — so 30 India leads
 * split fairly between India reps based on how many India leads they already
 * hold, not their unrelated total lead count.
 */
export async function bulkAssignByStrategy(
  db: Db,
  leadIds: string[],
  strategy: AssignmentStrategy,
  assignedTo: string | null,
): Promise<{ assigned: number; skipped: number }> {
  const now = new Date().toISOString();

  if (strategy === "manual") {
    const { error, count } = await db
      .from("leads")
      .update({ assigned_to: assignedTo, assigned_at: assignedTo ? now : null }, { count: "exact" })
      .in("id", leadIds);
    if (error) throw new Error(error.message);
    return { assigned: count ?? leadIds.length, skipped: 0 };
  }

  const { data: leads } = await db.from("leads").select("id, country").in("id", leadIds);

  let assigned = 0;
  let skipped = 0;

  if (strategy === "territory") {
    const candidatesByRegion = new Map<Territory, string[]>();
    const pickersByRegion = new Map<Territory, LoadBalancedPicker>();

    for (const lead of leads ?? []) {
      const region = normalizeTerritory(lead.country as string | null);
      if (!region) { skipped++; continue; }

      if (!candidatesByRegion.has(region)) {
        candidatesByRegion.set(region, await candidatesForRegion(db, region));
      }
      const candidates = candidatesByRegion.get(region)!;

      if (!pickersByRegion.has(region)) {
        pickersByRegion.set(region, new LoadBalancedPicker(await getTerritoryScopedLoads(db, candidates, region)));
      }
      const picker = pickersByRegion.get(region)!;

      const assigneeId = picker.pick(candidates);
      if (!assigneeId) { skipped++; continue; }
      await db.from("leads").update({ assigned_to: assigneeId, assigned_at: now }).eq("id", lead.id);
      assigned++;
    }
    return { assigned, skipped };
  }

  // round_robin: one global least-loaded picker across all active employees.
  const picker = await LoadBalancedPicker.create(db);
  const allCandidates = await getActiveEmployees(db);
  for (const lead of leads ?? []) {
    const assigneeId = picker.pick(allCandidates);
    if (!assigneeId) { skipped++; continue; }
    await db.from("leads").update({ assigned_to: assigneeId, assigned_at: now }).eq("id", lead.id);
    assigned++;
  }
  return { assigned, skipped };
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

  const candidates = await getActiveEmployees(db);
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
