/** Strip quoted-reply lines from plain-text email bodies. */
export function stripQuotedText(text: string | null | undefined): string | null {
  if (!text) return null;
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(">")) break;
    if (/^On .+wrote:\s*$/i.test(trimmed)) break;
    if (trimmed === "--" || trimmed === "\u2014") break;
    kept.push(line);
  }
  return kept.join("\n").trim() || null;
}

export function emailPreview(text: string | null | undefined, html: string | null | undefined, max = 160): string {
  const raw = stripQuotedText(text) ?? text ?? html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}

export function ueTypeToDirection(ueType: number): string {
  switch (ueType) {
    case 1: return "sent_campaign";
    case 2: return "received";
    case 3: return "sent_manual";
    case 4: return "scheduled";
    default: return "received";
  }
}
