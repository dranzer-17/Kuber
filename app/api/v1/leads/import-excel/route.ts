import { NextRequest } from "next/server";
import crypto from "crypto";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { ExcelImportSchema } from "@/lib/validators/leads";

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
  db: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>
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

  for (let i = 0; i < toInsert.length; i += CHUNK) {
    for (const row of toInsert.slice(i, i + CHUNK)) {
      const normalizedDomain = row.org_domain ? normalizeDomain(row.org_domain) : null;
      // Fix D: null out domain if it doesn't match the email domain
      const safeDomain = (normalizedDomain && domainMismatch(normalizedDomain, row.email))
        ? null
        : normalizedDomain;
      let orgId: string;
      if (safeDomain) {
        const { data: byDomain } = await db.from("organizations").select("id").eq("domain", safeDomain).maybeSingle();
        if (byDomain) { orgId = byDomain.id; }
        else {
          const { data: created } = await db.from("organizations")
            .insert({ name: row.org_name, domain: safeDomain, created_at: new Date().toISOString() })
            .select("id").single();
          orgId = created!.id;
        }
      } else {
        const { data: byName } = await db.from("organizations").select("id").ilike("name", row.org_name).maybeSingle();
        if (byName) { orgId = byName.id; }
        else {
          const { data: created } = await db.from("organizations")
            .insert({ name: row.org_name, created_at: new Date().toISOString() })
            .select("id").single();
          orgId = created!.id;
        }
      }
      const { error } = await db.from("leads").insert({
        email: row.email, first_name: row.first_name ?? null,
        last_name: row.last_name ?? null, title: row.title ?? null,
        country: row.country ?? null, organization_id: orgId!,
        apollo_id: `excel_${emailHash(row.email)}`,
        lead_source: "excel", created_by: userId,
        created_at: new Date().toISOString(),
      });
      if (!error) insertedCount++;
      else if (error.code === "23505") skippedDuplicateInDb++;
    }
  }

  return { inserted: insertedCount, skipped_blank_email: skippedBlankEmail, skipped_invalid_email: skippedInvalidEmail, skipped_duplicate_in_file: skippedDuplicateInFile, skipped_duplicate_in_db: skippedDuplicateInDb };
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
    const { rows, mapping } = parsed.data;
    if (!mapping["email"]) return fail(400, "VALIDATION_ERROR", "Mapping must include an 'email' column");
    const result = await processRows(rows, mapping, user.id, db);
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
  const { mapping } = parsed.data;
  if (!mapping["email"]) return fail(400, "VALIDATION_ERROR", "Mapping must include an 'email' column");
  const result = await processRows(parsed_excel.rows, mapping, user.id, db);
  return ok(result);
}
