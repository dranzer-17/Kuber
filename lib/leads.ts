export type LeadStatus =
  | "New" | "Enriching" | "Enriched" | "Draft Ready"
  | "In Review" | "Approved" | "Sent" | "Replied";

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
  // new enrichment fields
  orgId: string | null;
  enrichmentStage: EnrichmentStage | null;
  companyDescription: string | null;
  sellsTo: string | null;
  // legacy org intelligence fields
  hasScraped: boolean;
  primaryProducts: string[];
  competitors: string[];
  newsSummary: string | null;
  intentSignals: string[];
};

export const PIPELINE_STAGES: LeadStatus[] = [
  "New", "Enriching", "Enriched", "Draft Ready", "In Review", "Approved", "Sent", "Replied",
];

export const STEP_DESCRIPTIONS: Record<LeadStatus, string> = {
  New: "Lead created, awaiting enrichment",
  Enriching: "Firecrawl + Apollo running",
  Enriched: "Company profile ready",
  "Draft Ready": "AI email draft generated",
  "In Review": "Awaiting human approval",
  Approved: "Draft approved, queued to send",
  Sent: "Email delivered",
  Replied: "Lead responded",
};

export const STATUS_ORDER: Record<LeadStatus, number> = {
  New: 0, Enriching: 1, Enriched: 2, "Draft Ready": 3,
  "In Review": 4, Approved: 5, Sent: 6, Replied: 7,
};
