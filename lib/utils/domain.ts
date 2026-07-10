const APP_SUBDOMAINS = /^(app|dashboard|portal|login|my|account|admin|web|mail|crm|api|secure)\./i;

export function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")           // strip path
    .toLowerCase()
    .replace(APP_SUBDOMAINS, "");   // strip non-marketing subdomains
}

// Free/webmail providers — never inferred as a company's own domain.
export const FREE_EMAIL_PROVIDERS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
  "protonmail.com", "proton.me", "aol.com", "gmx.com", "yandex.com",
  "zoho.com", "mail.com", "rediffmail.com", "live.com", "msn.com", "me.com",
]);

const EMAIL_REGEX = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

/**
 * Derives a normalized company domain from a lead's email address.
 * Returns null for malformed addresses or free/webmail providers.
 */
export function deriveDomainFromEmail(email: string): string | null {
  const match = EMAIL_REGEX.exec(email.trim().toLowerCase());
  if (!match) return null;
  const domain = normalizeDomain(match[1]);
  if (!domain || FREE_EMAIL_PROVIDERS.has(domain)) return null;
  return domain;
}
