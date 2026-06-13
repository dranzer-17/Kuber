const TIMEOUTS: Record<string, number> = {
  apollo: 30_000,
  firecrawl: 60_000,
  llm: 90_000,
};

const RETRY_DELAYS = [1_000, 3_000, 9_000];

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE = new Set([400, 401, 402, 403, 404, 422]);

export async function fetchWithRetry(
  service: "apollo" | "firecrawl" | "llm",
  url: string,
  init: RequestInit
): Promise<Response> {
  const timeout = TIMEOUTS[service];

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (NON_RETRYABLE.has(res.status)) return res;
      if (!RETRYABLE.has(res.status)) return res;

      if (attempt === RETRY_DELAYS.length) return res;

      const retryAfter = res.headers.get("Retry-After");
      const delay = retryAfter
        ? parseInt(retryAfter) * 1_000
        : RETRY_DELAYS[attempt];
      await sleep(delay);
    } catch (err) {
      clearTimeout(timer);
      if (attempt === RETRY_DELAYS.length) throw err;
      await sleep(RETRY_DELAYS[attempt]);
    }
  }

  throw new Error("fetchWithRetry: exhausted retries");
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
