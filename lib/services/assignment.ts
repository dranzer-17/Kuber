import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;
type Territory = "india" | "foreign";

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

async function pickRoundRobin(
  db: Db,
  settingsId: string,
  cursor: string | null,
  candidateIds: string[],
): Promise<string> {
  const lastIdx = cursor ? candidateIds.indexOf(cursor) : -1;
  const next = candidateIds[(lastIdx + 1) % candidateIds.length];
  await db
    .from("assignment_settings")
    .update({ round_robin_cursor: next, updated_at: new Date().toISOString() })
    .eq("id", settingsId);
  return next;
}

/** Resolves who a newly-enriched lead should auto-assign to, or null to leave it in the Manager's pool. */
export async function resolveAssignee(db: Db, leadCountry: string | null | undefined): Promise<string | null> {
  const { data: settings } = await db
    .from("assignment_settings")
    .select("id, strategy, round_robin_cursor")
    .limit(1)
    .maybeSingle();

  if (!settings || settings.strategy === "manual") return null;

  if (settings.strategy === "territory") {
    const territory = normalizeTerritory(leadCountry);
    if (!territory) return null;
    const candidates = await getActiveEmployees(db, territory);
    if (!candidates.length) return null;
    return pickRoundRobin(db, settings.id, settings.round_robin_cursor, candidates);
  }

  const candidates = await getActiveEmployees(db);
  if (!candidates.length) return null;
  return pickRoundRobin(db, settings.id, settings.round_robin_cursor, candidates);
}

/** Auto-assigns any still-unassigned leads under an org right after it finishes enrichment. */
export async function autoAssignEnrichedLeads(db: Db, orgId: string): Promise<void> {
  const { data: leads } = await db
    .from("leads")
    .select("id, country")
    .eq("organization_id", orgId)
    .eq("is_deleted", false)
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
