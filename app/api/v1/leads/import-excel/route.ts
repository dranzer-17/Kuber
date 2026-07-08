import { NextRequest, after } from "next/server";
import crypto from "crypto";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { ExcelImportSchema } from "@/lib/validators/leads";
import { internalAppBaseUrl } from "@/lib/internal-url";

export const maxDuration = 300;

function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

// Fix D: detect when org domain doesn't match the email domain
function domainMismatch(orgDomain: string | null, email: string | null): boolean {
  if (!orgDomain || !email) return false;
  const emailDomain = email.split("@")[1] ?? "";
  return !emailDomain.includes(orgDomain) && !orgDomain.includes(emailDomain.split(".").slice(-2).join("."));
}

// Fix D: reject country values that look like job titles (Excel column misalignment)
const TITLE_KEYWORDS = /^(manager|director|ceo|cfo|coo|cto|officer|executive|president|head|lead|chief|vp|supervisor|coordinator)$/i;
function sanitizeCountry(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length <= 2) return undefined; // too short to be a country name
  if (TITLE_KEYWORDS.test(trimmed)) return undefined;
  return trimmed;
}

function emailHash(email: string): string {
  return crypto.createHash("sha1").update(email.toLowerCase()).digest("hex");
}

async function parseExcel(buffer: Buffer): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Empty workbook");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (rows.length === 0) throw new Error("No rows found");
  const headers = Object.keys(rows[0]);
  return { headers, rows };
}

async function processRows(
  rows: Record<string, unknown>[],
  mapping: Record<string, string>,
  userId: string,
  db: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
  importId?: string | null
) {
  const emailCol = mapping["email"];
  const firstNameCol = mapping["first_name"];
  const lastNameCol = mapping["last_name"];
  const orgNameCol = mapping["organization_name"];
  const orgDomainCol = mapping["organization_domain"];
  const titleCol = mapping["title"];
  const countryCol = mapping["country"];

  let insertedCount = 0;
  let skippedBlankEmail = 0;
  let skippedInvalidEmail = 0;
  let skippedDuplicateInFile = 0;
  let skippedDuplicateInDb = 0;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const seenEmails = new Set<string>();
  const validRows: Array<{
    email: string; first_name?: string; last_name?: string;
    org_name: string; org_domain?: string; title?: string; country?: string;
  }> = [];

  for (const row of rows) {
    const rawEmail = String(row[emailCol] ?? "").trim();
    if (!rawEmail) { skippedBlankEmail++; continue; }
    if (!emailRegex.test(rawEmail)) { skippedInvalidEmail++; continue; }
    const email = rawEmail.toLowerCase();
    if (seenEmails.has(email)) { skippedDuplicateInFile++; continue; }
    seenEmails.add(email);
    validRows.push({
      email,
      first_name: firstNameCol ? String(row[firstNameCol] ?? "").trim() || undefined : undefined,
      last_name: lastNameCol ? String(row[lastNameCol] ?? "").trim() || undefined : undefined,
      org_name: orgNameCol ? String(row[orgNameCol] ?? "").trim() || "Unknown" : "Unknown",
      org_domain: orgDomainCol ? String(row[orgDomainCol] ?? "").trim() || undefined : undefined,
      title: titleCol ? String(row[titleCol] ?? "").trim() || undefined : undefined,
      country: sanitizeCountry(countryCol ? String(row[countryCol] ?? "").trim() || undefined : undefined),
    });
  }

  const CHUNK = 500;

  // ── 1. Dedupe against existing emails (batched) ───────────────────────────
  const existingEmails = new Set<string>();
  for (let i = 0; i < validRows.length; i += CHUNK) {
    const chunk = validRows.slice(i, i + CHUNK).map((r) => r.email);
    const { data: existing } = await db.from("leads").select("email").in("email", chunk);
    (existing ?? []).forEach((r) => existingEmails.add(r.email));
  }

  const toInsert = validRows.filter((r) => {
    if (existingEmails.has(r.email)) { skippedDuplicateInDb++; return false; }
    return true;
  });
  if (toInsert.length === 0) {
    return { inserted: 0, skipped_blank_email: skippedBlankEmail, skipped_invalid_email: skippedInvalidEmail, skipped_duplicate_in_file: skippedDuplicateInFile, skipped_duplicate_in_db: skippedDuplicateInDb };
  }

  // ── 2. Resolve orgs in bulk ───────────────────────────────────────────────
  // Compute safe domain per row upfront
  const rowsWithDomain = toInsert.map((r) => {
    const nd = r.org_domain ? normalizeDomain(r.org_domain) : null;
    const safeDomain = nd && !domainMismatch(nd, r.email) ? nd : null;
    return { ...r, safeDomain };
  });

  const uniqueDomains = [...new Set(rowsWithDomain.map((r) => r.safeDomain).filter(Boolean) as string[])];
  const uniqueNames   = [...new Set(rowsWithDomain.filter((r) => !r.safeDomain).map((r) => r.org_name.toLowerCase()))];

  // Fetch existing orgs by domain
  const domainToOrgId = new Map<string, string>();
  if (uniqueDomains.length > 0) {
    for (let i = 0; i < uniqueDomains.length; i += CHUNK) {
      const { data } = await db.from("organizations").select("id, domain").in("domain", uniqueDomains.slice(i, i + CHUNK));
      (data ?? []).forEach((o) => { if (o.domain) domainToOrgId.set(o.domain, o.id); });
    }
  }

  // Fetch existing orgs by name (for domain-less rows)
  const nameToOrgId = new Map<string, string>();
  if (uniqueNames.length > 0) {
    // ilike OR filter not supported for bulk — use .in with lower() via rpc fallback; use sequential batches
    const nameChunks = [];
    for (let i = 0; i < uniqueNames.length; i += 50) nameChunks.push(uniqueNames.slice(i, i + 50));
    for (const chunk of nameChunks) {
      const { data } = await db.from("organizations").select("id, name").in("name", chunk);
      (data ?? []).forEach((o) => { if (o.name) nameToOrgId.set(o.name.toLowerCase(), o.id); });
    }
  }

  // Create missing orgs in bulk
  const missingDomainOrgs = uniqueDomains
    .filter((d) => !domainToOrgId.has(d))
    .map((d) => {
      const row = rowsWithDomain.find((r) => r.safeDomain === d)!;
      return { name: row.org_name, domain: d, created_at: new Date().toISOString() };
    });

  const missingNameOrgs = uniqueNames
    .filter((n) => !nameToOrgId.has(n))
    .map((n) => {
      const row = rowsWithDomain.find((r) => !r.safeDomain && r.org_name.toLowerCase() === n)!;
      return { name: row.org_name, created_at: new Date().toISOString() };
    });

  if (missingDomainOrgs.length > 0) {
    const { data } = await db.from("organizations").insert(missingDomainOrgs).select("id, domain");
    (data ?? []).forEach((o) => { if (o.domain) domainToOrgId.set(o.domain, o.id); });
  }
  if (missingNameOrgs.length > 0) {
    const { data } = await db.from("organizations").insert(missingNameOrgs).select("id, name");
    (data ?? []).forEach((o) => { if (o.name) nameToOrgId.set(o.name.toLowerCase(), o.id); });
  }

  // ── 3. Build lead rows and bulk insert ────────────────────────────────────
  const leadRows = rowsWithDomain.map((row) => {
    const orgId = row.safeDomain ? domainToOrgId.get(row.safeDomain) : nameToOrgId.get(row.org_name.toLowerCase());
    if (!orgId) return null;
    return {
      email: row.email,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      title: row.title ?? null,
      country: row.country ?? null,
      organization_id: orgId,
      apollo_id: `excel_${emailHash(row.email)}`,
      lead_source: "excel",
      created_by: userId,
      import_id: importId ?? null,
      created_at: new Date().toISOString(),
    };
  }).filter(Boolean) as object[];

  for (let i = 0; i < leadRows.length; i += CHUNK) {
    const { data, error } = await db.from("leads").insert(leadRows.slice(i, i + CHUNK)).select("id");
    if (!error) insertedCount += (data ?? []).length;
    else if (error.code === "23505") skippedDuplicateInDb += leadRows.slice(i, i + CHUNK).length;
  }

  return { inserted: insertedCount, skipped_blank_email: skippedBlankEmail, skipped_invalid_email: skippedInvalidEmail, skipped_duplicate_in_file: skippedDuplicateInFile, skipped_duplicate_in_db: skippedDuplicateInDb };
}

function triggerScrape(req: NextRequest) {
  if (!process.env.INTERNAL_SECRET) return;
  const base = internalAppBaseUrl(req);
  const secret = process.env.INTERNAL_SECRET;
  after(() =>
    fetch(`${base}/api/enrich/scrape-orgs`, {
      method: "POST",
      headers: { "x-internal-secret": secret },
    }).catch(() => {})
  );
}

export async function POST(req: NextRequest) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = ExcelImportSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  // Direct mode — rows provided in the request body, no storage needed
  if (parsed.data.mode === "direct") {
    const { rows, mapping, batch_name, color } = parsed.data;
    if (!mapping["email"]) return fail(400, "VALIDATION_ERROR", "Mapping must include an 'email' column");
    const { data: importRow } = await db.from("imports")
      .insert({ label: batch_name, source: "excel", created_by: user.id, lead_count: 0, color: color ?? "violet" })
      .select("id").single();
    const importId = importRow?.id ?? null;
    const result = await processRows(rows, mapping, user.id, db, importId);
    if (importId && result.inserted > 0) {
      await db.from("imports").update({ lead_count: result.inserted }).eq("id", importId);
    }
    if (result.inserted > 0) triggerScrape(req);
    return ok(result);
  }

  // Storage modes — download file first
  const { data: fileData, error: dlError } = await db.storage
    .from("excel-imports")
    .download(parsed.data.storage_path);
  if (dlError || !fileData) return fail(422, "VALIDATION_ERROR", "Could not download file from storage");

  const buffer = Buffer.from(await fileData.arrayBuffer());
  let parsed_excel: Awaited<ReturnType<typeof parseExcel>>;
  try {
    parsed_excel = await parseExcel(buffer);
  } catch (e) {
    return fail(422, "VALIDATION_ERROR", `Could not parse Excel file: ${(e as Error).message}`);
  }

  if (parsed.data.mode === "headers") {
    return ok({ columns: parsed_excel.headers });
  }

  // mode === "import"
  const { mapping, batch_name: importBatchName, color: importColor } = parsed.data as { mapping: Record<string, string>; batch_name: string; color: string };
  if (!mapping["email"]) return fail(400, "VALIDATION_ERROR", "Mapping must include an 'email' column");
  const { data: importRow2 } = await db.from("imports")
    .insert({ label: importBatchName, source: "excel", created_by: user.id, lead_count: 0, color: importColor ?? "violet" })
    .select("id").single();
  const importId2 = importRow2?.id ?? null;
  const result = await processRows(parsed_excel.rows, mapping, user.id, db, importId2);
  if (importId2 && result.inserted > 0) {
    await db.from("imports").update({ lead_count: result.inserted }).eq("id", importId2);
  }
  if (result.inserted > 0) triggerScrape(req);
  return ok(result);
}
