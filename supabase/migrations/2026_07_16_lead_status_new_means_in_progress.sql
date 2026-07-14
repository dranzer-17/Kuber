-- "New" = the enrichment pipeline is still working; "Input Required" = the
-- pipeline CONCLUDED (org done/failed) and something is genuinely missing
-- (planning.md Phase 3 / Q4). Previously a fresh Apollo import showed 100
-- "Input Required" the moment it landed because the no-email check ran first.
--
-- Signature unchanged — both triggers (trg_lead_status_self, trg_org_sync_leads)
-- keep calling it as before.

create or replace function public.compute_lead_status(
  p_status lead_status_enum,
  p_email text,
  p_org_domain text,
  p_org_stage enrichment_stage_enum,
  p_org_company_description text
)
returns lead_status_enum
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $$
begin
  -- terminal statuses are never auto-changed
  if p_status in ('open','closed') then
    return p_status;
  end if;

  -- Pipeline still in flight (org queued/scraping): the lead is NEW regardless
  -- of what's missing — don't cry wolf while enrichment is running. Ingest
  -- paths mark orgs 'failed' when nothing will ever scrape them, and a
  -- watchdog concludes stale queues, so this state always resolves.
  -- (enrichment_stage defaults to 'queued'; NULL here means the lead has no
  -- organization at all — nothing will ever enrich it, so fall through.)
  if p_org_stage in ('queued','scraping') then
    return 'new';
  end if;

  -- Pipeline concluded (done / failed / no org): judge what's missing.
  if p_email is null or p_email = '' then
    return 'input_required';
  end if;
  if p_org_stage = 'failed' then
    return 'input_required';  -- usable via the generic template (has email)
  end if;
  if p_org_domain is null or p_org_domain = '' then
    return 'input_required';
  end if;
  if p_org_company_description is null or p_org_company_description = '' then
    return 'input_required';
  end if;
  return 'enriched';
end;
$$;

-- Orgs that will never be scraped must not leave their leads in "New" forever:
-- anything without a domain that isn't already concluded is concluded now.
update public.organizations
   set enrichment_stage = 'failed',
       enrichment_status = 'No website found',
       enrichment_done_at = coalesce(enrichment_done_at, now())
 where (domain is null or domain = '')
   and (enrichment_stage is null or enrichment_stage in ('queued','scraping'));

-- Recompute every non-terminal lead under the new rules (the no-op update
-- fires trg_lead_status_self per row).
update public.leads l
   set status = compute_lead_status(l.status, l.email, o.domain, o.enrichment_stage, o.company_description)
  from public.organizations o
 where o.id = l.organization_id
   and l.is_deleted = false
   and l.status not in ('open','closed')
   and l.status is distinct from
       compute_lead_status(l.status, l.email, o.domain, o.enrichment_stage, o.company_description);

-- Leads with no organization at all: concluded-with-nothing → input_required.
update public.leads
   set status = 'input_required'
 where organization_id is null
   and is_deleted = false
   and status not in ('open','closed','input_required');
