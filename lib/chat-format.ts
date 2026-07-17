const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatChatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

export function formatChatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = startOfLocalDay(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const day = startOfLocalDay(date);

  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return dateFormatter.format(date);
}

export function startsNewChatDay(currentIso: string, previousIso?: string): boolean {
  if (!previousIso) return true;
  return startOfLocalDay(new Date(currentIso)) !== startOfLocalDay(new Date(previousIso));
}
