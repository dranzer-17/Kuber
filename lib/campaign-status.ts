/** Per-campaign lead journey buckets (Campaign Kanban + Report stage donut). */

export type CampaignKanbanBucket =
  | "pending"
  | "draft"
  | "approved"
  | "sent";

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
  const ds = unwrapDraft(cl.email_drafts)?.status;
  if (ds === "approved") return "approved";
  if (ds === "sent") return "sent";
  if (ds === "draft") return "draft";
  return "pending";
}

export function isFailedDraft(cl: CampaignLeadLike): boolean {
  return unwrapDraft(cl.email_drafts)?.status === "failed";
}

export const CAMPAIGN_KANBAN_COLS: {
  id: CampaignKanbanBucket;
  label: string;
  dot: string;
  header: string;
}[] = [
  { id: "pending", label: "Pending", dot: "bg-zinc-400", header: "border-zinc-500/30" },
  { id: "draft", label: "Draft Ready", dot: "bg-blue-400", header: "border-blue-500/30" },
  { id: "approved", label: "Certified", dot: "bg-cyan-400", header: "border-cyan-500/30" },
  { id: "sent", label: "Sent", dot: "bg-teal-400", header: "border-teal-500/30" },
];

export const CAMPAIGN_BUCKET_LABELS: Record<CampaignKanbanBucket, string> = {
  pending: "Pending",
  draft: "Draft Ready",
  approved: "Certified",
  sent: "Sent",
};
