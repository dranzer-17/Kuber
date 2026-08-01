-- Distinguish "org enrichment in flight, email not yet revealed" (enriching)
-- from "org enrichment in flight, email already revealed" (new). Previously
-- both collapsed to 'new' unconditionally, which is why the app had to filter
-- leads on email IS NOT NULL everywhere just to hide pre-reveal shells (see
-- lib/server/lead-visibility.ts onlyRevealedLeads — left in place as a
-- second, independent safeguard, not replaced by this).
--
-- No application code changes needed: the existing BEFORE INSERT/UPDATE
-- trigger (lead_status_self) already recomputes status via this function on
-- every insert and on every update that touches email/organization_id/status.
-- A fresh Apollo insert has org.enrichment_stage='queued' and email=null, so
-- it now lands as 'enriching'; the moment enrichLeads() writes a real email
-- (still 'queued'/'scraping' at that point), the same trigger recomputes it
-- to 'new' automatically.
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
as $function$
begin
  if p_status in ('open','closed') then
    return p_status;
  end if;

  -- Pipeline still in flight (org queued/scraping): NEW only once an email
  -- actually exists. Before that it's a pre-reveal shell that may still be
  -- archived out entirely if Apollo has no email on file for this person.
  if p_org_stage in ('queued','scraping') then
    if p_email is null or p_email = '' then
      return 'enriching';
    end if;
    return 'new';
  end if;

  if p_email is null or p_email = '' then
    return 'input_required';
  end if;
  if p_org_stage = 'failed' then
    return 'input_required';
  end if;
  if p_org_domain is null or p_org_domain = '' then
    return 'input_required';
  end if;
  if p_org_company_description is null or p_org_company_description = '' then
    return 'input_required';
  end if;
  return 'enriched';
end;
$function$;
