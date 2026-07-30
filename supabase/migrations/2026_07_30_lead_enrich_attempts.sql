-- Apollo email-reveal (bulk_match) had no cap on retries: a lead whose
-- bulk_match call kept failing (Apollo timeout/5xx) got unlocked
-- (enrich_locked_at = null) on every failure and reclaimed by the next
-- self-chain or 15-min watchdog pass, forever. Org-level scraping already
-- gives up after 3 attempts (organizations.enrichment_attempts) -- this adds
-- the equivalent lifetime cap on the Apollo side.
alter table public.leads
  add column if not exists enrich_attempts integer not null default 0;
