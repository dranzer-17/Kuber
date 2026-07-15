import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";

// Surfaces recent upstream credit/auth failures so the UI can show a clear
// "top up / fix your API key" banner instead of leaving managers to decode raw
// HTTP 402 dumps buried in a lead's enrichment log. Scans the last few hours of
// enrichment_logs for the signatures of the three paid providers.
const LOOKBACK_HOURS = 6;

type ServiceIssue = { service: string; kind: "credits" | "auth"; message: string };

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const db = createAdminClient();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data: rows } = await db
    .from("enrichment_logs")
    .select("source, error, created_at")
    .not("error", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  const issues: ServiceIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: ServiceIssue) => {
    if (seen.has(issue.service)) return;
    seen.add(issue.service);
    issues.push(issue);
  };

  for (const row of rows ?? []) {
    const err = (row.error ?? "").toLowerCase();
    if (err.includes("openrouter") && err.includes("402")) {
      add({ service: "OpenRouter", kind: "credits", message: "OpenRouter is out of credits — company profiles can't be generated. Top up or update the OpenRouter API key." });
    } else if (err.includes("openai") && (err.includes("401") || err.includes("insufficient_quota") || err.includes("429"))) {
      add({ service: "OpenAI", kind: "credits", message: "OpenAI (LLM fallback) is rejecting requests — check its API key / billing." });
    }
    if (row.source === "firecrawl" && (err.includes("402") || err.includes("insufficient"))) {
      add({ service: "Firecrawl", kind: "credits", message: "Firecrawl is out of credits — company websites can't be read. Top up or update the Firecrawl API key." });
    }
    if (err.includes("apollo") && (err.includes("401") || err.includes("403"))) {
      add({ service: "Apollo", kind: "auth", message: "Apollo rejected the API key — lead emails can't be revealed. Update the Apollo master key." });
    }
  }

  return ok({ issues });
}
