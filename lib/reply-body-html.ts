/** Escape text for safe HTML insertion. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Tight signature block: one `<p>` with `<br>` line breaks (TipTap hardBreak-safe). */
export function signatureToHtml(block: string): string {
  const lines = block
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
}

/** Append signature to reply body. */
export function appendSignatureToBody(body: string, signatureBlock: string): string {
  if (!signatureBlock.trim()) return body;
  const sigHtml = signatureToHtml(signatureBlock);
  const isHtml = /^\s*<(p|div|ul|ol|h[1-6])\b/i.test(body);
  if (isHtml) return `${body}${sigHtml}`;
  const escaped = escapeHtml(body)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<p>${escaped}</p>${sigHtml}`;
}

/** Merge trailing single-line `<p>` tags (legacy per-line signature) into one tight block. */
function mergeTrailingSignatureParagraphs(html: string): string {
  const sigPattern = /^<p>([^<]{1,120})<\/p>$/i;
  const paragraphs: string[] = [];
  let rest = html;

  while (true) {
    const m = rest.match(/(<p>[^<]{1,120}<\/p>\s*)$/i);
    if (!m) break;
    const tail = m[1].trim();
    if (!sigPattern.test(tail)) break;
    const line = tail.replace(/<\/?p>/gi, "").trim();
    paragraphs.unshift(line);
    rest = rest.slice(0, m.index).trimEnd();
  }

  if (paragraphs.length < 2) return html;
  const hasEmail = paragraphs.some((l) => l.includes("@"));
  if (!hasEmail) return html;
  return rest + signatureToHtml(paragraphs.join("\n"));
}

/**
 * Normalize reply draft HTML so signatures survive TipTap round-trips and render tight.
 */
export function normalizeReplyBodyHtml(body: string): string {
  if (!body?.trim()) return body;

  let out = body;

  // Bare <br> siblings after closing tags → tight signature paragraph
  out = out.replace(
    /(<\/p>)\s*(?:<br\s*\/?>\s*){2,}([\s\S]+)$/i,
    (_m, close: string, tail: string) => {
      const lines = tail
        .split(/<br\s*\/?>/i)
        .map((l) => l.replace(/<[^>]+>/g, "").trim())
        .filter(Boolean);
      if (lines.length === 0) return close + tail;
      return close + signatureToHtml(lines.join("\n"));
    },
  );

  // Collapsed signature: single <p> with email + spaces, no internal <br>
  out = out.replace(
    /<p>\s*((?:(?!<).)*@[\w.-]+(?:(?!<).)*)\s*<\/p>\s*$/i,
    (match, inner: string) => {
      const t = inner.trim();
      if (t.includes("<br")) return match;
      const emailM = t.match(/[\w.+-]+@[\w.-]+\.\w+/);
      if (!emailM) return match;
      const email = emailM[0];
      const before = t.slice(0, t.indexOf(email)).trim();
      const after = t.slice(t.indexOf(email) + email.length).trim();
      const lines = [before, email, after].filter(Boolean);
      if (lines.length >= 2) return signatureToHtml(lines.join("\n"));
      return match;
    },
  );

  out = mergeTrailingSignatureParagraphs(out);

  return out;
}
