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

// "warning" = degraded but still functioning (a fallback is covering the gap);
// "critical" = the capability is actually down. Drives banner color (amber vs red).
type ServiceIssue = { service: string; kind: "credits" | "auth"; message: string; severity: "warning" | "critical" };

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const db = createAdminClient();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data: rows } = await db
    .from("enrichment_logs")
    .select("source, event, error, created_at")
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

    // Severity is derived from which event actually fired, not re-guessed
    // from env vars — with 6 possible LLM tiers (Settings > Keys), a fixed
    // "is OPENAI_API_KEY set" check can no longer tell whether a fallback is
    // actually covering the gap. scrape-orgs/route.ts already did that work
    // and logged the outcome; this just surfaces it.
    //
    // Both branches below share the SAME `service` value ("LLM providers")
    // deliberately — confirmed live that using two different names let a
    // stale critical SKIPPED_LOW_CREDITS row (from before a fallback was
    // configured) coexist in the response alongside a much more recent
    // warning row saying the fallback is actively covering it. Sharing one
    // key means the newest-first row ordering's dedup-by-service correctly
    // lets the most recent event win.
    if (row.event === "PRIMARY_LLM_LOW_CREDITS_FALLBACK_ACTIVE") {
      add({ service: "LLM providers", kind: "credits", severity: "warning", message: row.error ?? "" });
    } else if (row.event === "SKIPPED_LOW_CREDITS" && (err.includes("no usable llm provider") || err.includes("openrouter") || err.includes("credit"))) {
      add({
        service: "LLM providers",
        kind: "credits",
        severity: "critical",
        message: "No configured LLM provider can generate company profiles right now — add or top up a key in Settings > Keys.",
      });
    } else if (row.source === "llm" && err.includes("openai") && (err.includes("401") || err.includes("403") || err.includes("insufficient_quota") || err.includes("429"))) {
      add({ service: "OpenAI", kind: "credits", severity: "critical", message: "OpenAI is rejecting requests — check its API key / billing." });
    }
    // The Firecrawl low-credit skip message ("Firecrawl is out of credits (N
    // left)") has neither "402" nor "insufficient" in it — match "credit" too.
    if (row.source === "firecrawl" && (err.includes("402") || err.includes("insufficient") || err.includes("credit"))) {
      add({ service: "Firecrawl", kind: "credits", severity: "critical", message: "Firecrawl is out of credits — company websites can't be read. Top up or update the Firecrawl API key." });
    }
    if (err.includes("apollo") && (err.includes("401") || err.includes("403"))) {
      add({ service: "Apollo", kind: "auth", severity: "critical", message: "Apollo rejected the API key — lead emails can't be revealed. Update the Apollo master key." });
    }
  }

  return ok({ issues });
}
