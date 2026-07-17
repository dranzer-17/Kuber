import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";

// Surfaces recent upstream credit/auth failures so the UI can show a clear
// "top up / fix your API key" banner instead of leaving managers to decode raw
// HTTP 402 dumps buried in a lead's enrichment log. Scans the last few hours of
// enrichment_logs for the signatures of the three paid providers.
//
// Deliberately looks at the NEWEST log row per provider, not "any error in the
// window" — an old 402 sitting in the last 6h must not keep the banner up
// after the key's been fixed and later scrapes are succeeding again. Rows with
// error: null (successes) are included in the query for exactly this reason:
// they're what lets a fixed key "win" over a stale error.
const LOOKBACK_HOURS = 6;

type ServiceIssue = { service: string; kind: "credits" | "auth"; message: string };

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const db = createAdminClient();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data: rows } = await db
    .from("enrichment_logs")
    .select("source, error, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  const issues: ServiceIssue[] = [];
  const decided = new Set<string>(); // provider keys whose newest relevant row we've already used

  for (const row of rows ?? []) {
    const err = (row.error ?? "").toLowerCase();

    if (row.source === "firecrawl" && !decided.has("firecrawl")) {
      decided.add("firecrawl");
      if (err.includes("402") || err.includes("insufficient")) {
        issues.push({ service: "Firecrawl", kind: "credits", message: "Firecrawl is out of credits — company websites can't be read. Top up or update the Firecrawl API key." });
      }
    }

    if (row.source === "llm" && !decided.has("llm")) {
      decided.add("llm");
      if (err.includes("openrouter") && err.includes("402")) {
        issues.push({ service: "OpenRouter", kind: "credits", message: "OpenRouter is out of credits — company profiles can't be generated. Top up or update the OpenRouter API key." });
      } else if (err.includes("openai") && (err.includes("401") || err.includes("insufficient_quota") || err.includes("429"))) {
        issues.push({ service: "OpenAI", kind: "credits", message: "OpenAI (LLM fallback) is rejecting requests — check its API key / billing." });
      }
    }

    if (err.includes("apollo") && !decided.has("apollo")) {
      decided.add("apollo");
      if (err.includes("401") || err.includes("403")) {
        issues.push({ service: "Apollo", kind: "auth", message: "Apollo rejected the API key — lead emails can't be revealed. Update the Apollo master key." });
      }
    }
  }

  return ok({ issues });
}
