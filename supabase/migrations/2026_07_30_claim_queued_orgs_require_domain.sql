-- Scrape-orgs must not claim domainless orgs.
--
-- Apollo Phase 1 inserts orgs as enrichment_stage=queued with no domain yet;
-- domains only land after Phase 2A (people/bulk_match email reveal). The
-- enrichment watchdog and scrape self-chain were claiming those domainless
-- shells and immediately failing them as NO_DOMAIN / DOMAIN_INFERENCE_FAILED,
-- racing Phase 2A and flipping leads to Input Required before any email existed.
--
-- Phase 2B only makes sense once a domain is present — require it at claim time.

create or replace function public.claim_queued_orgs(p_batch_size int)
returns setof organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update organizations
  set enrichment_stage = 'scraping',
      enrichment_status = 'SCRAPE_BATCH_STARTED',
      enrichment_started_at = now(),
      updated_at = now()
  where id in (
    select id from organizations
    where enrichment_stage = 'queued'
      and domain is not null
      and domain <> ''
    order by created_at asc
    limit p_batch_size
    for update skip locked
  )
  returning *;
end;
$$;

grant execute on function public.claim_queued_orgs(int) to service_role;
