import type { SupabaseClient } from "@supabase/supabase-js";
import { scrapeOrg, searchWeb } from "@/lib/services/firecrawl";
import { complete, EXTRACTION_SYSTEM, INTELLIGENCE_SYSTEM } from "@/lib/services/llm";
import { sleep } from "@/lib/http";
import { z } from "zod";

const ExtractionSchema = z.object({
  description: z.string(),
  primary_products: z.array(z.string()),
});

const IntelligenceSchema = z.object({
  news_summary: z.string().nullable(),
  competitors: z.array(z.string()),
  intent_signals: z.array(z.string()),
});

export interface ScrapeOrgStats {
  scraped: number;
  skipped_no_domain: number;
  extraction_fallback_used: number;
  credits_used: number;
  failed: Array<{ org_id: string; stage: "scrape" | "extract" | "intelligence"; reason: string }>;
}

/** Scrape + extract + intelligence for a single org. Updates the DB row. */
export async function processOneOrg(
  db: SupabaseClient,
  org: { id: string; domain: string | null; name: string },
  stats: ScrapeOrgStats,
): Promise<void> {
  if (!org.domain) { stats.skipped_no_domain++; return; }

  let scrapeResult;
  try {
    scrapeResult = await scrapeOrg(org.domain);
  } catch (e) {
    stats.failed.push({ org_id: org.id, stage: "scrape", reason: (e as Error).message });
    return;
  }

  if (!scrapeResult) {
    stats.failed.push({ org_id: org.id, stage: "scrape", reason: "Firecrawl returned no data" });
    return;
  }

  stats.credits_used += scrapeResult.creditsUsed;

  // Save markdown to Supabase Storage
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const storagePath = `scrapes/${dateStamp}/${org.id}.md`;
  let mdPath: string | null = null;
  try {
    const { error } = await db.storage
      .from("scrapes")
      .upload(storagePath, scrapeResult.markdown, { contentType: "text/markdown", upsert: true });
    if (!error) mdPath = storagePath;
  } catch { /* non-fatal */ }

  // Extract from homepage markdown
  const mdChunk = scrapeResult.markdown.slice(0, 12_000);
  const isThin = mdChunk.trim().length < 300;

  let description: string | null = null;
  let primaryProducts: string[] = [];
  let usedFallback = false;

  if (!isThin) {
    try {
      const { json } = await complete({ system: EXTRACTION_SYSTEM, user: mdChunk });
      const v = ExtractionSchema.safeParse(json);
      if (v.success) {
        description = v.data.description;
        primaryProducts = v.data.primary_products;
      } else throw new Error("Shape mismatch");
    } catch {
      description = scrapeResult.metaDescription;
      usedFallback = true;
    }
  } else {
    description = scrapeResult.metaDescription;
    usedFallback = true;
  }

  if (!description && usedFallback) {
    stats.failed.push({ org_id: org.id, stage: "extract", reason: "Thin content and no metadata description" });
    return;
  }
  if (usedFallback) stats.extraction_fallback_used++;

  // Web intelligence via Firecrawl search
  let newsSummary: string | null = null;
  let competitors: string[] = [];
  let intentSignals: string[] = [];

  try {
    const [newsText, competitorText] = await Promise.all([
      searchWeb(`${org.name} funding news hiring expansion 2024 2025`, 5),
      searchWeb(`${org.name} competitors similar companies`, 4),
    ]);
    await sleep(300);

    const combined = [newsText, competitorText].filter(Boolean).join("\n\n===\n\n");
    if (combined.trim().length > 100) {
      const { json } = await complete({ system: INTELLIGENCE_SYSTEM, user: combined.slice(0, 14_000) });
      const v = IntelligenceSchema.safeParse(json);
      if (v.success) {
        newsSummary = v.data.news_summary;
        competitors = v.data.competitors;
        intentSignals = v.data.intent_signals;
      }
    }
  } catch { /* non-fatal */ }

  await db.from("organizations").update({
    description,
    primary_products: primaryProducts.length > 0 ? primaryProducts : null,
    firecrawl_md_path: mdPath,
    news_summary: newsSummary,
    competitors: competitors.length > 0 ? competitors : null,
    intent_signals: intentSignals.length > 0 ? intentSignals : null,
    has_scraped: true,
    updated_at: new Date().toISOString(),
  }).eq("id", org.id);

  // Fix A: sync leads.status for every lead under this org
  const hasData = !!(description) || primaryProducts.length > 0;
  await db.from("leads")
    .update({ status: hasData ? "enriched" : "input_required", updated_at: new Date().toISOString() })
    .eq("organization_id", org.id)
    .eq("is_deleted", false)
    .not("status", "in", '("open","closed")');

  // Set non-apollo leads in campaign_leads to 'enriched'
  const { data: nonApolloLeads } = await db
    .from("leads").select("id")
    .eq("organization_id", org.id)
    .neq("lead_source", "apollo");
  if (nonApolloLeads?.length) {
    await db.from("campaign_leads")
      .update({ crm_status: "enriched", updated_at: new Date().toISOString() })
      .in("lead_id", nonApolloLeads.map((l) => l.id))
      .eq("crm_status", "new");
  }

  stats.scraped++;
}

/** Scrape a list of org IDs sequentially. Safe to fire-and-forget. */
export async function scrapeOrgIds(db: SupabaseClient, orgIds: string[]): Promise<ScrapeOrgStats> {
  const stats: ScrapeOrgStats = { scraped: 0, skipped_no_domain: 0, extraction_fallback_used: 0, credits_used: 0, failed: [] };
  if (orgIds.length === 0) return stats;

  const { data: orgs } = await db
    .from("organizations")
    .select("id, domain, name")
    .in("id", orgIds)
    .eq("has_scraped", false)
    .not("domain", "is", null);

  for (const org of orgs ?? []) {
    await processOneOrg(db, org, stats);
    await sleep(300);
  }

  return stats;
}
