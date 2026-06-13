import { fetchWithRetry, sleep } from "@/lib/http";

const BASE = "https://api.firecrawl.dev/v2";

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
  };
}

export interface FirecrawlResult {
  success: boolean;
  data?: {
    markdown: string;
    metadata?: {
      statusCode?: number;
      description?: string;
      ogDescription?: string;
      creditsUsed?: number;
    };
  };
  error?: string;
}

export async function scrapePage(url: string): Promise<FirecrawlResult> {
  const res = await fetchWithRetry("firecrawl", `${BASE}/scrape`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });

  if (!res.ok) {
    return { success: false, error: `HTTP ${res.status}` };
  }

  return res.json();
}

export interface ScrapeOrgResult {
  markdown: string;
  metaDescription: string | null;
  creditsUsed: number;
}

export interface SearchResult {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
}

export interface FirecrawlSearchResult {
  success: boolean;
  data?: SearchResult[];
  error?: string;
}

/** Search the web via Firecrawl /v2/search. Returns top results as markdown snippets. */
export async function searchWeb(query: string, limit = 5): Promise<string> {
  try {
    const res = await fetchWithRetry("firecrawl", `${BASE}/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ query, limit, scrapeOptions: { formats: ["markdown"] } }),
    });

    if (!res.ok) return "";

    const json: FirecrawlSearchResult = await res.json();
    if (!json.success || !json.data?.length) return "";

    return json.data
      .map((r) => {
        const parts: string[] = [];
        if (r.title) parts.push(`## ${r.title}`);
        if (r.url) parts.push(`Source: ${r.url}`);
        if (r.markdown) parts.push(r.markdown.slice(0, 1500));
        else if (r.description) parts.push(r.description);
        return parts.join("\n");
      })
      .join("\n\n---\n\n");
  } catch {
    return "";
  }
}

/** Scrape homepage + /about, concat with separator. Returns null on total failure. */
export async function scrapeOrg(domain: string): Promise<ScrapeOrgResult | null> {
  const homeUrl = `https://${domain}`;
  const aboutUrl = `https://${domain}/about`;

  const homeResult = await scrapePage(homeUrl);

  if (
    !homeResult.success ||
    !homeResult.data?.markdown ||
    (homeResult.data?.metadata?.statusCode ?? 200) >= 400
  ) {
    return null;
  }

  let markdown = homeResult.data.markdown;
  const credits = homeResult.data.metadata?.creditsUsed ?? 1;
  const metaDescription =
    homeResult.data.metadata?.description ??
    homeResult.data.metadata?.ogDescription ??
    null;

  await sleep(300);

  const aboutResult = await scrapePage(aboutUrl);
  if (
    aboutResult.success &&
    aboutResult.data?.markdown &&
    (aboutResult.data?.metadata?.statusCode ?? 200) < 400
  ) {
    markdown += "\n\n---\n\n" + aboutResult.data.markdown;
  }

  return { markdown, metaDescription, creditsUsed: credits };
}
