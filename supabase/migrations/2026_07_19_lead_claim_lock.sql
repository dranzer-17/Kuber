-- Email-reveal (bulk_match) has no atomic "claim" the way org-scraping already
-- does via claim_queued_orgs — two concurrent /api/v1/leads/enrich calls (the
-- natural self-chain overlapping a watchdog nudge, say) can both select the
-- same pending leads and both pay Apollo for the same people. Can't reuse
-- `status` as the lock column: trg_lead_status_self recomputes NEW.status on
-- every UPDATE OF status and would immediately bounce anything but
-- new/input_required/enriched/open/closed back to a real value, silently
-- undoing a 'enriching' marker before the row even commits. A dedicated
-- timestamp column sidesteps that entirely and self-expires (no separate
-- stuck-lead watchdog needed — a lock older than 10 minutes is just eligible
-- to be reclaimed).

alter table public.leads
  add column if not exists enrich_locked_at timestamptz;

create or replace function public.claim_unenriched_leads(p_ids uuid[])
returns setof leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update leads
  set enrich_locked_at = now()
  where id in (
    select id from leads
    where id = any(p_ids)
      and has_email = true
      and email is null
      and is_deleted = false
      and (enrich_locked_at is null or enrich_locked_at < now() - interval '10 minutes')
    for update skip locked
  )
  returning *;
end;
$$;

grant execute on function public.claim_unenriched_leads(uuid[]) to service_role;
