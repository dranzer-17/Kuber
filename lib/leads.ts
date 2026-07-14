export type LeadStatus =
  | "Input Required"
  | "New" | "Enriching" | "Enriched"
  | "Open" | "Closed";

export type LeadScore = "Hot" | "Cold" | "—";

export type LeadSource = "Apollo" | "Excel" | "Manual";

export type EnrichmentStage = "queued" | "scraping" | "done" | "failed";

export type DomainSource = "apollo" | "email_inferred" | "manual";

export type Lead = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  domain: string;
  domainSource: DomainSource | null;
  jobTitle: string;
  phone: string;
  country: string;
  status: LeadStatus;
  score: LeadScore;
  source: LeadSource;
  campaign: string;
  campaigns: { id: string; name: string; crm_status: string }[];
  createdAt: string;
  orgId: string | null;
  enrichmentStage: EnrichmentStage | null;
  companyDescription: string | null;
  sellsTo: string | null;
  lastError: string | null;
  hasScraped: boolean;
  importId: string | null;
  batchLabel: string | null;
  batchColor: string | null;
  assignedTo: string | null;
  // Set only when fetched via the single-lead GET route (review §3.4) — lets
  // the viewer know their lead's company profile is shared with other
  // people's leads, since org-level enrichment fans out regardless of owner.
  orgShared: { otherLeadCount: number; otherOwnerCount: number } | null;
};

export const PIPELINE_STAGES: LeadStatus[] = [
  "New", "Input Required", "Enriched", "Open", "Closed",
];

/** Kanban columns match full lead lifecycle including Input Required. */
export const KANBAN_STAGES: LeadStatus[] = [
  "New", "Input Required", "Enriched", "Open", "Closed",
];

/** Client-facing labels. Internal status values stay stable for the DB + filters. */
export const STATUS_LABELS: Record<LeadStatus, string> = {
  "Input Required": "Input Required",
  New: "New",
  Enriching: "Enriching",
  Enriched: "Enriched",
  Open: "Win",
  Closed: "Closed",
};

export const STEP_DESCRIPTIONS: Record<LeadStatus, string> = {
  "Input Required": "Enrichment finished — needs an email, or will use the generic template",
  New: "In queue — enrichment is running on this lead",
  Enriching: "Firecrawl scraping company website",
  Enriched: "Company profile ready",
  Open: "Active — outreach in progress",
  Closed: "No longer pursuing this lead",
};

export const STATUS_ORDER: Record<LeadStatus, number> = {
  New: 0, "Input Required": 1,
  Enriching: 2, Enriched: 2,
  Open: 3, Closed: 4,
};

// The canary field: company_description (written by scrape-orgs route).
export function hasEnrichmentData(lead: Lead): boolean {
  return lead.enrichmentStage === "done" && !!lead.companyDescription;
}

/**
 * DB trigger `compute_lead_status` is now authoritative — just return the status.
 * See Backend.md v7 §1.3 for the trigger definition.
 */
export function kanbanColumnFor(lead: Lead): LeadStatus {
  return lead.status;
}

export function isRecentlyAdded(lead: Lead): boolean {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  return lead.source === "Apollo" && new Date(lead.createdAt).getTime() > cutoff;
}

/**
 * A lead can join a campaign if it has an email AND is either:
 *   • Enriched — gets an AI-personalised draft, or
 *   • Input Required — no usable company profile (no website / unscrapeable /
 *     enrichment failed), so it gets the generic name-swap template instead.
 * New / Enriching leads are NOT eligible — enrichment is still in flight.
 */
export function isCampaignEligible(lead: Lead): boolean {
  return !!lead.email && (lead.status === "Enriched" || lead.status === "Input Required");
}

/**
 * True when an eligible lead has no usable company data and will therefore be
 * drafted from the generic (name-swap) template rather than AI-personalised.
 */
export function usesGenericTemplate(lead: Lead): boolean {
  return isCampaignEligible(lead) && !hasEnrichmentData(lead);
}

export function campaignIneligibleReason(lead: Lead): string | null {
  if (!lead.email) return "No email address — cannot send to this lead";
  if (lead.status === "Enriched" || lead.status === "Input Required") return null;
  if (lead.status === "Enriching") return "Company enrichment in progress — wait until it finishes";
  if (lead.status === "New") return "Not enriched yet — waiting for enrichment to run";
  return "This lead is not eligible for campaigns";
}

// ── Status sub-color classifier ─────────────────────────────────────────────

export type InputRequiredReason = "missing_data" | "failed" | null;

/**
 * Why a lead is in Input Required — drives the badge label + sub-color.
 * "missing_data" = no email → unusable until someone adds one.
 * "failed"       = has email but no usable company profile (no website /
 *                  unscrapeable / enrichment failed) → campaign-eligible via
 *                  the generic name-swap template.
 */
export function inputRequiredReason(lead: Lead): InputRequiredReason {
  if (lead.status !== "Input Required") return null;
  if (!lead.email) return "missing_data";
  return "failed";
}

/** Human label for the two Input-Required flavours (planning.md Phase 3.3). */
export function inputRequiredLabel(lead: Lead): string {
  return inputRequiredReason(lead) === "missing_data" ? "Needs email" : "No website · generic";
}

export const ENRICHMENT_DOT_HELP: Record<EnrichmentStage | "none", string> = {
  queued: "Company queued for website scrape. Not ready for campaigns yet.",
  scraping: "Firecrawl is scraping the company website. Wait until enrichment completes.",
  done: "Company profile ready — safe to add to campaigns.",
  failed: "Enrichment failed (often no website). This lead can still join a campaign — it will use the generic template.",
  none: "Not enriched yet. Cannot add to campaigns until company data is ready.",
};

export const CAMPAIGN_STATUS_HELP: Record<string, string> = {
  draft: "AI draft generated. Review, edit, then certify.",
  approved: "You certified this draft. Ready to send to Instantly.",
  sent: "Pushed to Instantly for delivery.",
  generating: "AI is writing the email in the background.",
  failed: "Draft generation failed. Click Regenerate to try again.",
  pending: "Waiting for draft generation to start or finish.",
  none: "No draft available for this lead yet.",
};

export const CAMPAIGN_ACTION_HELP = {
  certifyAll: "Approves all draft-ready emails at once without selecting each one.",
  certifySelected: "Approves only the leads you checked in the sidebar.",
  sendSelected: "Sends only the certified leads you checked in the sidebar.",
  sendCertified: "Sends only certified leads to Instantly. Uncertified drafts are not sent.",
  humanInLoop: "When ON, every draft must be certified by you before it can be sent.",
  enrichmentColumn: "Green = enriched and campaign-ready. Red = failed. Yellow = in progress.",
  statusColumn: "Lead pipeline status in your CRM based on enrichment and campaign progress.",
};

export const DRAFT_BADGE_SHORT: Record<string, string> = {
  generating: "Generating",
  draft: "Draft",
  approved: "Certified",
  sent: "Sent",
  failed: "Failed",
  rejected: "Rejected",
  pending: "Pending",
};

export function leadFullName(lead: Pick<Lead, "firstName" | "lastName">): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
}

export type LeadsSort = "newest" | "oldest" | "az" | "za";
export type CampaignLeadsSort = "az" | "newest";

export function sortLeads(leads: Lead[], sort: LeadsSort): Lead[] {
  const copy = [...leads];
  if (sort === "newest") return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sort === "oldest") return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (sort === "az") return copy.sort((a, b) => leadFullName(a).localeCompare(leadFullName(b)));
  return copy.sort((a, b) => leadFullName(b).localeCompare(leadFullName(a)));
}

export function getMostCommonCountry(leads: Pick<Lead, "country">[]): string | null {
  const counts: Record<string, number> = {};
  for (const l of leads) {
    const c = l.country?.trim();
    if (!c) continue;
    counts[c] = (counts[c] ?? 0) + 1;
  }
  let best: string | null = null;
  let max = 0;
  for (const [country, n] of Object.entries(counts)) {
    if (n > max) { max = n; best = country; }
  }
  return best;
}
