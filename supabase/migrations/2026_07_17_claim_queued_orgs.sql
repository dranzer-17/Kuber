-- Atomic claim of queued organizations for the scrape-orgs worker (review §3.5).
-- Previously the worker did SELECT queued orgs, THEN UPDATE them to
-- 'scraping' as two separate statements — two concurrent invocations could
-- both select the same org before either wrote 'scraping', causing duplicate
-- Firecrawl/LLM spend and duplicate log rows. FOR UPDATE SKIP LOCKED makes
-- concurrent claims disjoint (the same pattern already used by
-- assignment_pick_round_robin for atomic lead assignment).
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
    order by created_at asc
    limit p_batch_size
    for update skip locked
  )
  returning *;
end;
$$;

grant execute on function public.claim_queued_orgs(int) to service_role;
