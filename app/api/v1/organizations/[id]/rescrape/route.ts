import { NextRequest, after } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { internalAppBaseUrl } from "@/lib/internal-url";

// Rescrape spends Firecrawl/LLM credits — managers only. Employees never manage
// enrichment; they work whatever leads they're assigned (planning.md D8).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireManager(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();

  const { data: org, error } = await db
    .from("organizations")
    .select("id, enrichment_stage, enrichment_attempts")
    .eq("id", id)
    .maybeSingle();

  if (error) return fail(500, "INTERNAL", error.message);
  if (!org) return fail(404, "NOT_FOUND", "Organization not found");

  if (org.enrichment_stage === "scraping") {
    return fail(409, "IN_PROGRESS", "Enrichment is already running for this organization");
  }
  if ((org.enrichment_attempts ?? 0) >= 3) {
    return fail(409, "MAX_ATTEMPTS", "This organization has reached the maximum retry limit (3 attempts)");
  }

  if (org.enrichment_stage !== "queued") {
    await db.from("organizations").update({
      has_scraped: false,
      enrichment_stage: "queued",
      enrichment_status: "SCRAPE_QUEUED",
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    await db.from("enrichment_logs").insert({
      org_id: id,
      source: "system",
      event: "SCRAPE_QUEUED",
      payload: { triggered_by: "rescrape", previous_stage: org.enrichment_stage },
      created_at: new Date().toISOString(),
    });
  } else {
    await db.from("organizations").update({
      has_scraped: false,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
  }

  if (process.env.INTERNAL_SECRET) {
    const baseUrl = internalAppBaseUrl(req);
    const secret = process.env.INTERNAL_SECRET;
    after(() =>
      fetch(`${baseUrl}/api/enrich/scrape-orgs`, {
        method: "POST",
        headers: { "x-internal-secret": secret },
      }).catch(() => {})
    );
  }

  return ok({ id, queued_for_rescrape: true });
}
