import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;
type Territory = "india" | "foreign";
export type AssignmentStrategy = "manual" | "round_robin" | "territory";

function normalizeTerritory(country: string | null | undefined): Territory | null {
  if (!country) return null;
  return country.trim().toLowerCase() === "india" ? "india" : "foreign";
}

async function getActiveEmployees(db: Db, territory?: Territory) {
  let query = db.from("profiles").select("id").eq("role", "employee").eq("is_active", true);
  if (territory) query = query.eq("territory", territory);
  const { data } = await query.order("id");
  return (data ?? []).map((row) => row.id as string);
}

async function getCursorRow(db: Db) {
  const { data } = await db
    .from("assignment_settings")
    .select("id, round_robin_cursor")
    .limit(1)
    .maybeSingle();
  return data;
}

async function pickRoundRobin(
  db: Db,
  settingsId: string,
  cursor: string | null,
  candidateIds: string[],
): Promise<string> {
  // Atomic pick-and-advance (concurrency-safe) via RPC. Falls back to the old
  // read-modify-write only if the function isn't present yet (pre-migration §2.5).
  const { data, error } = await db.rpc("assignment_pick_round_robin", {
    p_candidate_ids: candidateIds,
  });
  if (!error && typeof data === "string" && data) return data;

  const lastIdx = cursor ? candidateIds.indexOf(cursor) : -1;
  const next = candidateIds[(lastIdx + 1) % candidateIds.length];
  await db
    .from("assignment_settings")
    .update({ round_robin_cursor: next, updated_at: new Date().toISOString() })
    .eq("id", settingsId);
  return next;
}

/**
 * Resolves who a lead should assign to under an explicitly-chosen strategy —
 * used by the manual "Assign" bulk action (strategy picked per action, not
 * read from a persisted default). Returns null for "manual" (caller supplies
 * the assignee directly in that case) or when no eligible candidate exists.
 */
export async function resolveAssigneeForStrategy(
  db: Db,
  strategy: AssignmentStrategy,
  leadCountry: string | null | undefined,
): Promise<string | null> {
  if (strategy === "manual") return null;

  const cursorRow = await getCursorRow(db);
  if (!cursorRow) return null;

  if (strategy === "territory") {
    const territory = normalizeTerritory(leadCountry);
    if (!territory) return null;
    const candidates = await getActiveEmployees(db, territory);
    if (!candidates.length) return null;
    return pickRoundRobin(db, cursorRow.id, cursorRow.round_robin_cursor, candidates);
  }

  const candidates = await getActiveEmployees(db);
  if (!candidates.length) return null;
  return pickRoundRobin(db, cursorRow.id, cursorRow.round_robin_cursor, candidates);
}

/**
 * Assigns a specific set of leads under an explicitly-chosen strategy (the
 * manual bulk "Assign" action on the Leads page). For "manual", every lead
 * goes to `assignedTo`. For "round_robin"/"territory", each lead is resolved
 * one at a time (round-robin must advance sequentially per lead).
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
      .update({ assigned_to: assignedTo, assigned_at: assignedTo ? now : null, updated_at: now })
      .in("id", leadIds);
    if (error) throw new Error(error.message);
    return { assigned: count ?? leadIds.length, skipped: 0 };
  }

  const { data: leads } = await db.from("leads").select("id, country").in("id", leadIds);

  let assigned = 0;
  let skipped = 0;
  for (const lead of leads ?? []) {
    const assigneeId = await resolveAssigneeForStrategy(db, strategy, lead.country as string | null);
    if (!assigneeId) { skipped++; continue; }
    await db
      .from("leads")
      .update({ assigned_to: assigneeId, assigned_at: now, updated_at: now })
      .eq("id", lead.id);
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

  if (!settings) return null;
  return resolveAssigneeForStrategy(db, settings.strategy as AssignmentStrategy, leadCountry);
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
