export type UniboxReadStateFilter = "all" | "unread" | "read" | "replied" | "needs_reply";
export type UniboxInterestFilter = "all" | "lead" | number;

export const READ_STATE_OPTIONS: { value: UniboxReadStateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
  { value: "replied", label: "Replied" },
  { value: "needs_reply", label: "Needs reply" },
];

export const INTEREST_FILTER_OPTIONS: { value: UniboxInterestFilter; label: string; color: string }[] = [
  { value: "lead", label: "Lead", color: "text-muted-foreground" },
  { value: 1, label: "Interested", color: "text-green-500" },
  { value: 2, label: "Meeting booked", color: "text-purple-500" },
  { value: 3, label: "Meeting completed", color: "text-orange-500" },
  { value: 4, label: "Won", color: "text-lime-500" },
  { value: 0, label: "Out of office", color: "text-blue-500" },
  { value: -1, label: "Not interested", color: "text-red-400" },
  { value: -2, label: "Wrong person", color: "text-slate-400" },
  { value: -3, label: "Lost", color: "text-rose-500" },
];
