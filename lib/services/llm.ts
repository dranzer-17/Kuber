import { fetchWithRetry } from "@/lib/http";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

interface CompletionOpts {
  system: string;
  user: string;
}

export interface LlmResult<T> {
  json: T;
  tier: 1 | 2;
}

async function parseJsonResponse(text: string): Promise<object> {
  let cleaned = text.trim();
  // strip markdown fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    // extract first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("No parseable JSON in LLM response");
  }
}

function openRouterHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    "X-Title": "Kuber Polyplast",
  };
}

async function callOpenRouter(opts: CompletionOpts): Promise<object> {
  const model = process.env.LLM_PRIMARY_MODEL ?? "anthropic/claude-sonnet-4-5";
  const res = await fetchWithRetry("llm", OPENROUTER_URL, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw Object.assign(new Error(`OpenRouter ${res.status}: ${err}`), {
      status: res.status,
    });
  }

  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";
  return parseJsonResponse(content);
}

async function callOpenAI(opts: CompletionOpts): Promise<object> {
  const model = process.env.LLM_FALLBACK_MODEL ?? "gpt-4o-mini";
  const res = await fetchWithRetry("llm", OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw Object.assign(new Error(`OpenAI ${res.status}: ${err}`), {
      status: res.status,
    });
  }

  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";
  return parseJsonResponse(content);
}

const NON_RETRYABLE_STATUSES = new Set([401, 402, 403]);

export async function complete<T = object>(opts: CompletionOpts): Promise<LlmResult<T>> {
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY?.trim();
  const hasOpenAI = !!process.env.OPENAI_API_KEY?.trim();
  let openRouterError: Error | null = null;

  if (hasOpenRouter) {
    try {
      const json = (await callOpenRouter(opts)) as T;
      return { json, tier: 1 };
    } catch (err) {
      openRouterError = err instanceof Error ? err : new Error(String(err));
      const status = (err as { status?: number }).status;
      // Retryable HTTP errors (429, 5xx) should surface immediately.
      if (status && !NON_RETRYABLE_STATUSES.has(status)) {
        throw openRouterError;
      }
      // 401/402/403 or non-HTTP errors (e.g. JSON parse): try OpenAI fallback if configured.
    }
  }

  if (hasOpenAI) {
    try {
      const json = (await callOpenAI(opts)) as T;
      return { json, tier: 2 };
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  if (openRouterError) throw openRouterError;

  throw new Error("No LLM provider configured — set OPENROUTER_API_KEY or OPENAI_API_KEY");
}

export interface ExtractionOutput {
  description: string;
  primary_products: string[];
}

export interface DraftOutput {
  subject: string;
  body: string;
}

export const EXTRACTION_SYSTEM = `You extract company facts for B2B sales. Return ONLY valid JSON, no markdown fences: { "description": string (2-3 sentences: what they manufacture and who they sell to), "primary_products": string[] }`;

export interface IntelligenceOutput {
  news_summary: string | null;
  competitors: string[];
  intent_signals: string[];
}

export const INTELLIGENCE_SYSTEM = `You are a B2B sales intelligence analyst. Given web search results about a company, extract the following. Return ONLY valid JSON, no markdown fences:
{
  "news_summary": string | null,  // 1-2 sentences summarising recent news, funding, or expansions. null if nothing relevant found.
  "competitors": string[],         // list of competitor company names mentioned. empty array if none found.
  "intent_signals": string[]       // buying/growth signals: hiring roles, new markets, product launches, expansions. empty array if none found.
}`;

export function buildDraftSystem(): string {
  return `Write a cold outreach email from Kuber Polyplast (Indian masterbatch & specialty compounds manufacturer, 30 years, exports to 50+ countries) to the lead below. Return ONLY JSON {"subject": string, "body": string}. Reference their products specifically. Under 120 words, no placeholders.`;
}
