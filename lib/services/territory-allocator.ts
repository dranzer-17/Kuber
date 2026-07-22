import { canonicalCountry } from "@/lib/territory";

export type AllocLead = { id: string; country: string | null };
export type Coverage = { employeeId: string; countries: Set<string> };

export type Allocation = {
  /** lead id → employee id */
  assignments: Map<string, string>;
  /** lead ids nobody covers (or with no/unknown country) — these stay in the pool */
  unmatched: string[];
};

/**
 * Decide who gets which lead, for one batch of leads.
 *
 * ─── Why this is not a plain rotation ────────────────────────────────────────
 * Rotating each country's owners in turn looks fair and is not. Take the case
 * this was built for:
 *
 *   100 leads: 30 India, 20 Europe, 50 US
 *   A covers India · B covers Europe · C covers everywhere
 *
 * Rotation splits Europe B/C/B/C and lands on A=30, B=10, C=60 — C doing six
 * times B's work. The reason is that rotation settles Europe without knowing
 * that C is about to be buried under 50 US leads nobody else can take.
 *
 * So leads are grouped by WHO CAN TAKE THEM and the groups with the fewest
 * possible owners are settled first:
 *
 *   1. US    → only C can       → C = 50
 *   2. India → only A can       → A = 30
 *   3. Europe→ B or C; B has 0, C already has 50 → all 20 go to B
 *
 *   A=30  B=20  C=50
 *
 * Forced choices are made before free ones, so by the time a contested group is
 * reached, the running totals already reflect the work nobody else could do.
 *
 * ─── The load rule, and why it is narrow on purpose ──────────────────────────
 * `priorInBatch` must only ever count leads from the batch/import being
 * assigned right now. It must NEVER carry anyone's lifetime lead count.
 *
 * That is not a style preference. Commit 69062e2 removed exactly that: picking
 * whoever had the fewest leads overall meant one employee received every single
 * lead until their book caught up with everyone else's (Kavish 60 / Rudraksh 48
 * sent every India lead to Rudraksh). Counting only the current import keeps the
 * balancing that makes the example above work, while resetting to zero each
 * import so nobody can be frozen out.
 *
 * Pure function: no database, no clock, no randomness. Same inputs, same
 * output — which is what makes it testable and what makes an odd split
 * explainable after the fact.
 */
export function allocateByTerritory(
  leads: readonly AllocLead[],
  coverage: readonly Coverage[],
  priorInBatch?: ReadonlyMap<string, number>,
): Allocation {
  const assignments = new Map<string, string>();
  const unmatched: string[] = [];

  // Group leads by the SET of employees who could take them — not by country.
  // India and Nepal belong together when the same one person covers both.
  const groups = new Map<string, { candidates: string[]; leadIds: string[] }>();

  for (const lead of leads) {
    const country = canonicalCountry(lead.country);
    if (!country) { unmatched.push(lead.id); continue; }

    const candidates = coverage
      .filter((c) => c.countries.has(country))
      .map((c) => c.employeeId)
      .sort();

    if (candidates.length === 0) { unmatched.push(lead.id); continue; }

    const key = candidates.join("|");
    const group = groups.get(key) ?? { candidates, leadIds: [] };
    group.leadIds.push(lead.id);
    groups.set(key, group);
  }

  // Fewest possible owners first. The key tie-break keeps runs deterministic.
  const ordered = [...groups.entries()].sort(([aKey, a], [bKey, b]) =>
    a.candidates.length - b.candidates.length || aKey.localeCompare(bKey),
  );

  const counts = new Map<string, number>(priorInBatch ?? []);
  const countOf = (id: string) => counts.get(id) ?? 0;

  for (const [, group] of ordered) {
    for (const leadId of group.leadIds) {
      // Emptiest candidate wins. On a tie the sorted order picks the first,
      // whose count then increments — so ties alternate rather than always
      // favouring the same person.
      let chosen = group.candidates[0];
      for (const candidate of group.candidates) {
        if (countOf(candidate) < countOf(chosen)) chosen = candidate;
      }
      assignments.set(leadId, chosen);
      counts.set(chosen, countOf(chosen) + 1);
    }
  }

  return { assignments, unmatched };
}
