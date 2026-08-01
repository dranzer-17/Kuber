/**
 * The line between "a row in `leads`" and "a lead".
 *
 * An Apollo import lands in two paid steps. Step 1 (`mixed_people/api_search`)
 * returns people with a `has_email` FLAG but no address — those rows exist only
 * so step 2 (`people/bulk_match`) has an `apollo_id` to ask about. Step 2 is
 * what actually reveals the email and the company domain; only after it does
 * Firecrawl + the LLM have a domain to enrich against.
 *
 * A pre-reveal row is not something anyone can work: no email means no
 * outreach, and no domain means no company profile either. The rest of the
 * system already agrees — `leadIsAssignable` (lib/services/assignment.ts)
 * refuses to hand one to an employee, and `isCampaignEligible` (lib/leads.ts)
 * refuses to put one in a campaign. Worse, a chunk of them are *guaranteed to
 * be deleted*: when Apollo answers "no email on file" the row is archived into
 * `unenrichable_leads` and removed outright, so showing them means showing a
 * count that silently shrinks.
 *
 * Only the list views were still counting them as inventory. On 2026-07-30 an
 * import stalled between step 1 and step 2 (Apollo out of credits) and put 349
 * of these on the client's Leads page, where they sat looking like work for two
 * days. Hence this filter.
 *
 * Note this deliberately keys on the email, NOT on `status`. A lead is `new`
 * whenever its org is queued/scraping, which covers BOTH the useless pre-reveal
 * state and the useful post-reveal one (email in hand, Firecrawl still
 * running). Filtering on the email keeps the second — which is exactly what
 * "New" should have meant all along: revealed, being enriched, nearly ready.
 */
export function onlyRevealedLeads<T extends { not: (column: string, operator: "is", value: null) => T }>(q: T): T {
  return q.not("email", "is", null);
}
