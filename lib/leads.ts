export type LeadStatus =
  | "Input Required"
  | "New" | "Enriching" | "Enriched"
  | "Open" | "Closed";

export type LeadScore = "Hot" | "Cold" | "—";

export type LeadSource = "Apollo" | "Excel" | "Manual";

export type EnrichmentStage = "queued" | "scraping" | "done" | "failed";

export type Lead = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  domain: string;
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
  primaryProducts: string[];
  competitors: string[];
  newsSummary: string | null;
  intentSignals: string[];
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
  "Input Required": "Missing email or company domain — add details before enrichment",
  New: "Lead created, awaiting enrichment",
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
// primary_products is checked for future-proofing but is never populated by the current scraper.
// DO NOT add primary_products to the active scraper without also updating hasEnrichmentData.
export function hasEnrichmentData(lead: Lead): boolean {
  return (
    lead.enrichmentStage === "done" &&
    !!(lead.companyDescription || (lead.primaryProducts && lead.primaryProducts.length > 0))
  );
}

export function kanbanColumnFor(lead: Lead): LeadStatus {
  // Terminal CRM statuses take priority
  if (lead.status === "Open")   return "Open";
  if (lead.status === "Closed") return "Closed";
  // No email or domain → needs manual input before enrichment can run
  if (!lead.email || !lead.domain) return "Input Required";
  // Enrichment failed or finished but returned no useful data → still needs input
  if (lead.enrichmentStage === "failed") return "Input Required";
  if (lead.enrichmentStage === "done" && !hasEnrichmentData(lead)) return "Input Required";
  if (lead.enrichmentStage === "done")     return "Enriched";
  if (lead.enrichmentStage === "scraping") return "New";
  // queued or null → awaiting enrichment
  return "New";
}

export function isRecentlyAdded(lead: Lead): boolean {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  return lead.source === "Apollo" && new Date(lead.createdAt).getTime() > cutoff;
}

export function isCampaignEligible(lead: Lead): boolean {
  return !!lead.email && !!lead.domain && hasEnrichmentData(lead);
}

export function campaignIneligibleReason(lead: Lead): string | null {
  if (!lead.email) return "No email address";
  if (!lead.domain) return "No company domain — enrichment incomplete";
  if (lead.enrichmentStage === "failed") return "Company enrichment failed";
  if (lead.enrichmentStage === "done" && !hasEnrichmentData(lead))
    return "Company scraped but no usable data found — retry enrichment";
  if (lead.enrichmentStage !== "done") return "Company enrichment not finished yet";
  return null;
}

// ── Status sub-color classifier ─────────────────────────────────────────────

export type InputRequiredReason = "missing_data" | "failed" | null;

/** Why a lead is in Input Required — drives the card sub-color. */
export function inputRequiredReason(lead: Lead): InputRequiredReason {
  // Only meaningful for the Input Required column
  if (kanbanColumnFor(lead) !== "Input Required") return null;
  if (!lead.email || !lead.domain) return "missing_data";  // yellow
  return "failed";                                          // orange (has domain, but failed/no-data)
}

export const ENRICHMENT_DOT_HELP: Record<EnrichmentStage | "none", string> = {
  queued: "Company queued for website scrape. Not ready for campaigns yet.",
  scraping: "Firecrawl is scraping the company website. Wait until enrichment completes.",
  done: "Company profile ready — safe to add to campaigns.",
  failed: "Enrichment failed (often no domain). Cannot add to campaigns.",
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
