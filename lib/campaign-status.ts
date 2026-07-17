/** Per-campaign lead journey buckets (Campaign Kanban + Report stage donut). */

export type CampaignKanbanBucket =
  | "pending"
  | "draft"
  | "approved"
  | "sent"
  | "replied";

export type CampaignLeadLike = {
  crm_status: string;
  email_drafts?: { status: string } | { status: string }[] | null;
};

function unwrapDraft(
  raw: CampaignLeadLike["email_drafts"],
): { status: string } | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

/** Kanban / journey stages — failed and in-progress drafts count as Pending. */
export function campaignBucket(cl: CampaignLeadLike): CampaignKanbanBucket {
  // Check crm_status FIRST — a replied lead stays in "Replied"
  // regardless of what the email_drafts.status says.
  if (cl.crm_status === "replied") return "replied";
  const ds = unwrapDraft(cl.email_drafts)?.status;
  if (ds === "approved") return "approved";
  if (ds === "sent") return "sent";
  if (ds === "draft") return "draft";
  return "pending";
}

export function isFailedDraft(cl: CampaignLeadLike): boolean {
  return unwrapDraft(cl.email_drafts)?.status === "failed";
}

/**
 * Recomputes the campaign-card / analytics-tab summary numbers (leads, sent,
 * replied, hot, cold) from a set of campaign_leads rows. Used to give an
 * employee their OWN scoped counts — the campaigns table's total_leads /
 * sent_count / replied_count / hot_count / cold_count columns are campaign-wide
 * and were never meant to be shown to an employee as-is (spec §5: a campaign
 * is a shared container, an employee only sees/counts their own leads in it).
 */
export type CampaignStatsRow = CampaignLeadLike & { lead_temperature?: string | null };

export function computeCampaignStats(rows: CampaignStatsRow[]): {
  total_leads: number;
  sent_count: number;
  replied_count: number;
  hot_count: number;
  cold_count: number;
} {
  let sent_count = 0;
  let replied_count = 0;
  let hot_count = 0;
  let cold_count = 0;
  for (const r of rows) {
    const bucket = campaignBucket(r);
    if (bucket === "sent" || bucket === "replied") sent_count++;
    if (bucket === "replied") replied_count++;
    if (r.lead_temperature === "hot") hot_count++;
    if (r.lead_temperature === "cold") cold_count++;
  }
  return { total_leads: rows.length, sent_count, replied_count, hot_count, cold_count };
}

export const CAMPAIGN_KANBAN_COLS: {
  id: CampaignKanbanBucket;
  label: string;
  dot: string;
  header: string;
}[] = [
  { id: "pending",  label: "Pending",    dot: "bg-zinc-400",   header: "border-zinc-500/30"  },
  { id: "draft",    label: "Draft Ready",dot: "bg-blue-400",   header: "border-blue-500/30"  },
  { id: "approved", label: "Certified",  dot: "bg-cyan-400",   header: "border-cyan-500/30"  },
  { id: "sent",     label: "Sent",       dot: "bg-teal-400",   header: "border-teal-500/30"  },
  { id: "replied",  label: "Replied",    dot: "bg-violet-400", header: "border-violet-500/30" },
];

export const CAMPAIGN_BUCKET_LABELS: Record<CampaignKanbanBucket, string> = {
  pending:  "Pending",
  draft:    "Draft Ready",
  approved: "Certified",
  sent:     "Sent",
  replied:  "Replied",
};
