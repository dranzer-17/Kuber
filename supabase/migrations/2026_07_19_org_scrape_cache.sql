-- Cache the raw Firecrawl markdown on the org. When only the LLM extraction
-- step fails (e.g. OpenRouter 402 on low credits), a retry can reuse this
-- instead of paying Firecrawl to scrape the identical page again — the exact
-- wasteful loop seen in the logs (scrape ok -> extract 402 -> scrape again...).
alter table public.organizations
  add column if not exists scraped_markdown text,
  add column if not exists scraped_at timestamptz;
