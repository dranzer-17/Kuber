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

export type SplitMessageBody = {
  main: string | null;
  quoted: string | null;
};

const QUOTE_HTML_PATTERNS = [
  /<div[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>/i,
  /<blockquote[\s>]/i,
  /<div[^>]*class="[^"]*gmail_extra[^"]*"[^>]*>/i,
];

const QUOTE_TEXT_PATTERN = /\n\s*On .+wrote:\s*\n/i;

/** Split HTML/text body into main content and quoted history (Gmail-style). */
export function splitQuotedBody(
  html: string | null | undefined,
  text: string | null | undefined,
): SplitMessageBody {
  if (html) {
    for (const pattern of QUOTE_HTML_PATTERNS) {
      const match = html.match(pattern);
      if (match && match.index != null && match.index > 0) {
        const main = html.slice(0, match.index).trim();
        const quoted = html.slice(match.index).trim();
        if (main) return { main, quoted: quoted || null };
      }
    }
    const textMatch = html.match(/(?:<br\s*\/?>|\n)\s*On .+wrote:/i);
    if (textMatch && textMatch.index != null && textMatch.index > 0) {
      const main = html.slice(0, textMatch.index).trim();
      const quoted = html.slice(textMatch.index).trim();
      if (main) return { main, quoted: quoted || null };
    }
    return { main: html, quoted: null };
  }

  if (text) {
    const textMatch = text.match(QUOTE_TEXT_PATTERN);
    if (textMatch && textMatch.index != null && textMatch.index > 0) {
      return {
        main: text.slice(0, textMatch.index).trim() || null,
        quoted: text.slice(textMatch.index).trim() || null,
      };
    }
    const main = stripQuotedText(text);
    return { main: main ?? text, quoted: main && main.length < text.length ? text.slice(main.length).trim() || null : null };
  }

  return { main: null, quoted: null };
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
