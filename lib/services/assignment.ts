import { createAdminClient } from "@/lib/supabase/admin";
import { logLeadEvent } from "@/lib/services/lead-events";

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

/**
 * Candidates for a region (active + online reps in that territory):
 *   india   → india reps only (no sensible fallback — pool if none)
 *   foreign → foreign (rest-of-world) reps only
 */
async function candidatesForRegion(db: Db, region: Territory): Promise<string[]> {
  return getEligibleEmployees(db, region);
}

/**
 * The independently-rotating cursors. Round-robin ignores territory entirely and
 * rotates every eligible employee through "global"; territory routing rotates
 * each region's reps through that region's own lane, so India and foreign never
 * share a position.
 */
type Lane = "global" | Territory;

/**
 * The next `count` assignees for `lane`, in order — rotation, not load-balancing.
 * Deliberately does not consult how many leads anyone already has: the cursor
 * advances one employee per lead, so N leads across M employees divide evenly and
 * a remainder falls to whoever the cursor reaches first (8 across 3 → 3/3/2).
 *
 * The cursor lives in the database and is advanced under a row lock, so parallel
 * callers (several enrichments finishing at once) cannot read the same position
 * and hand the same employee both leads. One call covers a whole batch, so a
 * 500-lead import costs one round-trip per lane rather than 500.
 *
 * Returns [] only when the lane has no candidates at all; callers treat a short
 * result as "leave in the pool" rather than assigning to undefined.
 */
async function pickRoundRobin(db: Db, lane: Lane, candidateIds: string[], count: number): Promise<string[]> {
  if (candidateIds.length === 0 || count < 1) return [];
  const { data, error } = await db.rpc("assignment_pick_round_robin", {
    p_lane: lane,
    p_candidate_ids: candidateIds,
    p_count: count,
  });
  // Surfaced rather than silently falling back to a local pick: a broken cursor
  // that quietly degrades to "always the same employee" is the exact failure this
  // function replaced, and it is invisible until someone audits the lead counts.
  if (error) throw new Error(`Round-robin pick failed: ${error.message}`);
  return (data as string[] | null) ?? [];
}

/** Rich result summary for a bulk assignment (spec §3/§4). */
export type AssignmentSummary = {
  total: number;                    // leads processed
  newly_assigned: number;           // were unassigned (pool), now assigned
  reassigned: number;               // were assigned to someone else, now moved
  skipped_already_assigned: number; // left untouched because they were already assigned
  skipped_not_ready: number;        // still enriching (New) → can't be worked yet, left alone
  unmatched: number;                // territory/RR: no eligible employee (or no country) → left in pool
  eligible_employee_count: number;  // distinct eligible employees available for this run
  excluded_offline: number;         // active employees skipped for being offline
  excluded_deactivated: number;     // deactivated employees (never eligible)
  manual_target_offline: boolean;   // manual: chosen target is offline (allowed, but warned)
};

/**
 * A lead is workable — and therefore assignable to an employee — only once it
 * has an email AND enrichment has concluded (enriched, or input_required with a
 * usable email via the generic template). "New"/"enriching" leads are still in
 * the pipeline and must NOT be handed to an employee (they may still be
 * archived out entirely if Apollo never returns an email). Unassigning (moving
 * back to the pool) is always allowed regardless of readiness.
 */
function leadIsAssignable(row: { email: string | null; status: string | null }): boolean {
  return !!row.email && (row.status === "enriched" || row.status === "input_required");
}

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

  const { data: leads } = await db.from("leads").select("id, country, assigned_to, email, status").in("id", leadIds);
  const rows = leads ?? [];
  const exclusions = await getExclusionCounts(db);

  const summary: AssignmentSummary = {
    total: rows.length,
    newly_assigned: 0,
    reassigned: 0,
    skipped_already_assigned: 0,
    skipped_not_ready: 0,
    unmatched: 0,
    eligible_employee_count: 0,
    excluded_offline: exclusions.excluded_offline,
    excluded_deactivated: exclusions.excluded_deactivated,
    manual_target_offline: false,
  };

  // Guard used by every strategy: block assigning a not-ready lead TO an
  // employee. `target` null (manual → pool) is always allowed.
  function blockedNotReady(row: { email: string | null; status: string | null }, target: string | null): boolean {
    if (!target) return false;
    if (leadIsAssignable(row)) return false;
    summary.skipped_not_ready++;
    return true;
  }

  // Records one lead move and updates the summary tallies.
  async function applyAssignment(leadId: string, prior: string | null, next: string | null) {
    await db.from("leads").update({ assigned_to: next, assigned_at: next ? now : null }).eq("id", leadId);
    if (next && !prior) {
      summary.newly_assigned++;
      await logLeadEvent(db, leadId, "assigned", "Assigned to an employee", { metadata: { assignee_id: next } });
    } else if (next && prior && prior !== next) {
      summary.reassigned++;
      await logLeadEvent(db, leadId, "reassigned", "Reassigned to a different employee", { metadata: { from: prior, to: next } });
    } else if (!next && prior) {
      await logLeadEvent(db, leadId, "unassigned", "Returned to the pool", { metadata: { from: prior } });
    }
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
      if (blockedNotReady(lead, assignedTo)) continue;
      await applyAssignment(lead.id, prior, assignedTo);
    }
    return summary;
  }

  // Both rotating strategies settle which leads are actually in play BEFORE
  // drawing assignees, so a skipped lead never burns a cursor position and
  // leaves a gap in the rotation.
  type Target = { id: string; prior: string | null };
  const eligibleForRotation: (Target & { region: Territory | null })[] = [];
  for (const lead of rows) {
    const prior = (lead.assigned_to as string | null) ?? null;
    if (skipAlreadyAssigned && prior) { summary.skipped_already_assigned++; continue; }
    if (blockedNotReady(lead, "pending")) continue;
    eligibleForRotation.push({
      id: lead.id as string,
      prior,
      region: normalizeTerritory(lead.country as string | null),
    });
  }

  if (strategy === "territory") {
    const byRegion = new Map<Territory, Target[]>();
    for (const target of eligibleForRotation) {
      // No country → no region to route by; stays in the manager's pool.
      if (!target.region) { summary.unmatched++; continue; }
      const bucket = byRegion.get(target.region) ?? [];
      bucket.push(target);
      byRegion.set(target.region, bucket);
    }

    const eligibleEmployees = new Set<string>();
    for (const [region, targets] of byRegion) {
      const candidates = await candidatesForRegion(db, region);
      for (const id of candidates) eligibleEmployees.add(id);
      if (candidates.length === 0) { summary.unmatched += targets.length; continue; }

      const picks = await pickRoundRobin(db, region, candidates, targets.length);
      for (const [i, target] of targets.entries()) {
        const assigneeId = picks[i];
        if (!assigneeId) { summary.unmatched++; continue; }
        await applyAssignment(target.id, target.prior, assigneeId);
      }
    }
    summary.eligible_employee_count = eligibleEmployees.size;
    return summary;
  }

  // round_robin: territory is intentionally ignored — every eligible employee is
  // in one rotation regardless of which region the lead belongs to.
  const candidates = await getEligibleEmployees(db);
  summary.eligible_employee_count = candidates.length;
  const picks = await pickRoundRobin(db, "global", candidates, eligibleForRotation.length);
  for (const [i, target] of eligibleForRotation.entries()) {
    const assigneeId = picks[i];
    if (!assigneeId) { summary.unmatched++; continue; }
    await applyAssignment(target.id, target.prior, assigneeId);
  }
  return summary;
}

/**
 * Resolves who a ready lead should auto-assign to, or null to leave it in the
 * Manager's pool. Strategy comes from `strategyOverride` when supplied (the
 * lead's import-time choice — deferred assignment), otherwise the workspace
 * `assignment_settings` default. `manualTarget` is only consulted for the
 * "manual" strategy.
 */
export async function resolveAssignee(
  db: Db,
  leadCountry: string | null | undefined,
  strategyOverride?: AssignmentStrategy,
  manualTarget?: string | null,
): Promise<string | null> {
  let strategy = strategyOverride;
  if (!strategy) {
    const { data: settings } = await db
      .from("assignment_settings")
      .select("strategy")
      .limit(1)
      .maybeSingle();
    strategy = (settings?.strategy as AssignmentStrategy) ?? "manual";
  }

  if (strategy === "manual") {
    // Global manual = leave in pool. Import-time manual = the chosen employee
    // (validated active; a since-deactivated target falls back to the pool).
    if (!manualTarget) return null;
    const { data: target } = await db
      .from("profiles").select("id, is_active").eq("id", manualTarget).maybeSingle();
    return target?.is_active ? manualTarget : null;
  }

  if (strategy === "territory") {
    const region = normalizeTerritory(leadCountry);
    if (!region) return null;
    const candidates = await candidatesForRegion(db, region);
    // The region's own cursor, so leads trickling in one at a time still
    // alternate between same-region reps instead of piling onto one.
    const [assigneeId] = await pickRoundRobin(db, region, candidates, 1);
    return assigneeId ?? null;
  }

  const candidates = await getEligibleEmployees(db);
  const [assigneeId] = await pickRoundRobin(db, "global", candidates, 1);
  return assigneeId ?? null;
}

/** The deferred import choice for a lead, or null when it has no import / no stored choice. */
async function importChoiceFor(
  db: Db,
  importId: string | null,
): Promise<{ strategy: AssignmentStrategy; target: string | null } | null> {
  if (!importId) return null;
  const { data } = await db
    .from("imports")
    .select("assignment_strategy, assignment_target")
    .eq("id", importId)
    .maybeSingle();
  if (!data?.assignment_strategy) return null;
  return {
    strategy: data.assignment_strategy as AssignmentStrategy,
    target: (data.assignment_target as string | null) ?? null,
  };
}

/**
 * Auto-assigns still-unassigned leads under an org once they are ready to work —
 * that is, either fully enriched OR input_required (the company had no usable
 * website / enrichment failed, but the lead has an email and can be worked with
 * the generic template). New/enriching leads are intentionally left in the pool.
 *
 * Each lead is routed by its own import's stored choice (deferred assignment,
 * planning.md Phase 4 / Q5) — this is the ONLY place an Apollo/Excel import's
 * assignment actually takes effect, so an employee never receives a raw "New"
 * shell that might still get archived. Falls back to the workspace default for
 * leads with no import-time choice.
 */
export async function autoAssignEnrichedLeads(db: Db, orgId: string): Promise<void> {
  const { data: leads } = await db
    .from("leads")
    .select("id, country, import_id")
    .eq("organization_id", orgId)
    .eq("is_deleted", false)
    .in("status", ["enriched", "input_required"])
    .is("assigned_to", null);

  for (const lead of leads ?? []) {
    const choice = await importChoiceFor(db, lead.import_id as string | null);
    const assigneeId = await resolveAssignee(
      db,
      lead.country as string | null,
      choice?.strategy,
      choice?.target,
    );
    if (!assigneeId) continue;
    await db
      .from("leads")
      .update({ assigned_to: assigneeId, assigned_at: new Date().toISOString() })
      .eq("id", lead.id);
    await logLeadEvent(db, lead.id as string, "assigned", "Assigned to an employee", {
      metadata: { assignee_id: assigneeId, via: choice ? `import_${choice.strategy}` : "auto" },
    });
  }
}
