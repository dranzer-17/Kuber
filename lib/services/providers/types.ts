// Shared types for the multi-provider key/model system (Settings > Keys).
// `firecrawl` is the one "scrape" category provider today; everything else
// is "llm". New providers slot into ProviderId without touching the DB.
export type ProviderCategory = "llm" | "scrape";

export type ProviderId =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "groq"
  | "firecrawl";

export interface CompletionOpts {
  system: string;
  user: string;
  // Cap the response size. Without this, some providers default to the
  // model's full context and, on low balance, reject the request even
  // though the actual output is tiny.
  maxTokens?: number;
}

export type CreditCheck = { ok: boolean; remaining: number | null; message: string };
