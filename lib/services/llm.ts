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
  if (!text.trim()) throw new Error("Empty LLM response");

  let cleaned = text.trim();
  // strip markdown fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // extract first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    throw new Error(`No parseable JSON in LLM response: ${cleaned.slice(0, 120)}`);
  }
}

function extractMessageContent(data: unknown): string {
  const choice = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function supportsJsonResponseFormat(model: string): boolean {
  return model.startsWith("openai/") || /gpt|o1|o3|o4/i.test(model);
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
  const model = process.env.LLM_PRIMARY_MODEL ?? "anthropic/claude-sonnet-4-6";
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (supportsJsonResponseFormat(model)) {
    payload.response_format = { type: "json_object" };
  }

  const res = await fetchWithRetry("llm", OPENROUTER_URL, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw Object.assign(new Error(`OpenRouter ${res.status}: ${err}`), {
      status: res.status,
    });
  }

  const data = await res.json();
  const content = extractMessageContent(data);
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
  const content = extractMessageContent(data);
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

export const EXTRACTION_SYSTEM = `You extract company facts for B2B sales. Return ONLY valid JSON, no markdown fences: { "description": string (2-3 sentences: what they manufacture and who they sell to), "primary_products": string[] }`;

export const DRAFT_JSON_SUFFIX =
  '\n\nReturn ONLY valid JSON with no markdown fences: {"subject": string, "intro": string, "product_match": string}.\n' +
  'product_match must be the exact name of the matched product from the PRODUCT REFERENCE LIBRARY, or "none" if no product fits.\n' +
  '"intro" must contain ONLY the short personalised opening (1-2 sentences for a first email, or the full 2-4 sentence nudge for a follow-up) — never the Kuber Polyplast company pitch, offerings list, key strengths, accolades, or closing, which are appended automatically.';

