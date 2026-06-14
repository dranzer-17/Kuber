export type LeadStatus =
  | "Input Required"
  | "New" | "Enriching" | "Enriched" | "Draft Ready"
  | "Approved" | "Won" | "Closed";

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
  "Input Required", "New", "Enriching", "Enriched", "Draft Ready", "Approved", "Won", "Closed",
];

/** Kanban columns match full lead lifecycle including Input Required. */
export const KANBAN_STAGES: LeadStatus[] = [
  "Input Required", "New", "Enriching", "Enriched", "Draft Ready", "Approved", "Won", "Closed",
];

export const STEP_DESCRIPTIONS: Record<LeadStatus, string> = {
  "Input Required": "Missing email or company domain — add details before enrichment",
  New: "Lead created, awaiting enrichment",
  Enriching: "Firecrawl + Apollo running",
  Enriched: "Company profile ready",
  "Draft Ready": "AI email draft generated",
  Approved: "Draft approved, queued to send",
  Won: "Positive reply or deal won",
  Closed: "No longer pursuing this lead",
};

export const STATUS_ORDER: Record<LeadStatus, number> = {
  "Input Required": 0,
  New: 0, Enriching: 1, Enriched: 2, "Draft Ready": 3,
  Approved: 4, Won: 5, Closed: 6,
};

export function kanbanColumnFor(lead: Lead): LeadStatus {
  if (lead.status === "Input Required") return "Input Required";
  if (KANBAN_STAGES.includes(lead.status)) return lead.status;
  return "New";
}

export function isRecentlyAdded(lead: Lead): boolean {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  return lead.source === "Apollo" && new Date(lead.createdAt).getTime() > cutoff;
}

export function isCampaignEligible(lead: Lead): boolean {
  return !!lead.email && !!lead.domain && lead.enrichmentStage === "done";
}

export function campaignIneligibleReason(lead: Lead): string | null {
  if (!lead.email) return "No email address";
  if (!lead.domain) return "No company domain — enrichment incomplete";
  if (lead.enrichmentStage === "failed") return "Company enrichment failed";
  if (lead.enrichmentStage !== "done") return "Company enrichment not finished yet";
  return null;
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
