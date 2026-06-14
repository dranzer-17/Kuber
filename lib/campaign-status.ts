/** Per-campaign lead journey buckets (Campaign Kanban + Report). */

export type CampaignBucket =
  | "pending"
  | "draft"
  | "approved"
  | "sent"
  | "replied"
  | "won"
  | "closed";

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

export function campaignBucket(cl: CampaignLeadLike): CampaignBucket {
  const ds = unwrapDraft(cl.email_drafts)?.status;
  if (ds === "approved") return "approved";
  if (ds === "sent") return "sent";
  if (ds === "draft") return "draft";
  if (cl.crm_status === "replied") return "replied";
  if (cl.crm_status === "won") return "won";
  if (cl.crm_status === "closed") return "closed";
  return "pending";
}

export const CAMPAIGN_KANBAN_COLS: {
  id: CampaignBucket;
  label: string;
  dot: string;
  header: string;
}[] = [
  { id: "pending", label: "Pending", dot: "bg-zinc-400", header: "border-zinc-500/30" },
  { id: "draft", label: "Draft Ready", dot: "bg-blue-400", header: "border-blue-500/30" },
  { id: "approved", label: "Certified", dot: "bg-cyan-400", header: "border-cyan-500/30" },
  { id: "sent", label: "Sent", dot: "bg-teal-400", header: "border-teal-500/30" },
  { id: "replied", label: "Replied", dot: "bg-green-400", header: "border-green-500/30" },
  { id: "won", label: "Won", dot: "bg-emerald-400", header: "border-emerald-500/30" },
  { id: "closed", label: "Closed", dot: "bg-zinc-500", header: "border-zinc-600/30" },
];

export const CAMPAIGN_BUCKET_LABELS: Record<CampaignBucket, string> = {
  pending: "Pending",
  draft: "Draft Ready",
  approved: "Certified",
  sent: "Sent",
  replied: "Replied",
  won: "Won",
  closed: "Closed",
};
