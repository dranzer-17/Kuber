/**
 * Split a messy spreadsheet "full name" into first / last for CRM storage.
 *
 * Excel imports often map a single Name column onto first_name and leave
 * last_name empty. Values may include honorifics, job titles on later lines,
 * parenthetical notes, or "Name - Role" suffixes.
 */

const HONORIFIC =
  /^(?:mr|mrs|ms|miss|dr|prof|sir|madam|madame|mme|mlle|sr|sra|ing|lic|eng|arq|iq|i\.q|c\.p|cp)\.?$/i;

const ROLE_PREFIX = /^(?:owner|contact|buyer|purchasing|manager|director)\s*:\s*/i;

export type SplitName = { firstName: string; lastName: string };

/**
 * Normalize and split a full-name string.
 * - Uses only the first line (drops pasted job titles)
 * - Strips parenthetical notes and " - Role" suffixes
 * - Drops leading honorifics (Mr., Lic., Ing., …)
 * - First remaining token → firstName; the rest → lastName
 */
export function splitFullName(raw: string | null | undefined): SplitName {
  if (!raw) return { firstName: "", lastName: "" };

  let s = String(raw).replace(/\r\n?/g, "\n");
  s = s.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  if (!s) return { firstName: "", lastName: "" };

  s = s.replace(ROLE_PREFIX, "");
  // Drop parentheticals: "(BDM)", "(Cliente Name)", "(EMIN LTD)"
  s = s.replace(/\([^)]*\)/g, " ");
  // "Leonardo Sanchez - Ejecutivo de Ventas" → keep left side
  if (s.includes(" - ")) s = s.split(" - ")[0] ?? s;
  // Collapse whitespace / stray punctuation separators
  s = s.replace(/[|/]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return { firstName: "", lastName: "" };

  const tokens = s.split(" ").filter(Boolean);
  while (tokens.length > 0 && HONORIFIC.test(tokens[0]!)) {
    tokens.shift();
  }
  // Trailing honorifics are rare but show up as "Name Jr." — keep Jr/Sr/II as last-name parts
  if (tokens.length === 0) return { firstName: "", lastName: "" };
  if (tokens.length === 1) return { firstName: tokens[0]!, lastName: "" };

  return {
    firstName: tokens[0]!,
    lastName: tokens.slice(1).join(" "),
  };
}

/**
 * If lastName is empty but firstName looks like a full name, split it in place.
 * No-op when lastName is already set (separate columns were mapped).
 */
export function ensureSplitNames(firstName: string, lastName: string): SplitName {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (last || !first || !/\s/.test(first)) {
    return { firstName: first, lastName: last };
  }
  return splitFullName(first);
}
