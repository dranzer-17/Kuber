-- Multi-tenancy: turn the single-tenant app into a per-company "factory".
--
-- Every row in every domain table now belongs to exactly one company. The two
-- seeded companies are:
--   Company A  — the internal/dev workspace. Keeps ALL existing data (leads,
--                organizations, campaigns, drafts, unibox, logs) as test data.
--   Company B  — Kuber Polyplast production. Starts EMPTY; only configuration
--                (prompts, products, signature, templates) is copied into it by
--                the follow-up migration.
--
-- Company ids are fixed literals rather than gen_random_uuid() so later
-- migrations, seeds and manual queries can reference them deterministically.

-- ---------------------------------------------------------------------------
-- 1. The tenant table
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id         uuid primary key,
  name       text not null,
  slug       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is
  'Tenant root. Every domain row carries a company_id FK to this table; deleting a company cascades its entire workspace.';

insert into public.companies (id, name, slug) values
  ('00000000-0000-0000-0000-00000000000a', 'Kuber Internal (Dev)', 'dev'),
  ('00000000-0000-0000-0000-00000000000b', 'Kuber Polyplast',      'kuber-polyplast')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. company_id on every domain table
--
--    company_id is denormalised onto child tables (campaign_leads, email_drafts,
--    lead_events, ...) rather than resolved through their parent. It costs one
--    uuid per row and buys a flat `.eq('company_id', ...)` filter on every query
--    and a flat RLS policy on every table — no recursive joins.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  company_a constant uuid := '00000000-0000-0000-0000-00000000000a';
  tables constant text[] := array[
    -- lead / org pipeline
    'organizations', 'leads', 'imports', 'unenrichable_leads', 'enrichment_logs',
    'lead_events', 'lead_comments', 'lead_comment_reactions',
    -- campaign pipeline
    'campaigns', 'campaign_leads', 'campaign_steps', 'instantly_campaigns',
    'campaign_assignments', 'campaign_comments', 'campaign_comment_reactions',
    -- drafting / replies / inbox
    'email_drafts', 'reply_drafts', 'reply_events', 'unibox_emails',
    'draft_regeneration_jobs', 'draft_regeneration_job_items',
    -- configuration
    'settings', 'product_offerings', 'provider_keys', 'provider_settings',
    'llm_tier_config', 'assignment_settings', 'assignment_cursors',
    -- people
    'profiles', 'user_settings', 'user_signatures',
    -- audit
    'audit_log'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I add column if not exists company_id uuid', t);

    -- Everything that exists today belongs to the dev workspace.
    execute format('update public.%I set company_id = %L where company_id is null', t, company_a);

    execute format('alter table public.%I alter column company_id set not null', t);

    if not exists (
      select 1 from pg_constraint where conname = t || '_company_id_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (company_id) references public.companies(id) on delete cascade',
        t, t || '_company_id_fkey'
      );
    end if;

    execute format('create index if not exists %I on public.%I (company_id)', 'idx_' || t || '_company', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Rewrite global-unique constraints to be per-company
--
--    Without this, Company B literally cannot import a lead or scrape a domain
--    that the dev workspace already holds — the insert would collide with
--    Company A's row. These are the constraints that make the tenants
--    independent rather than merely filtered.
-- ---------------------------------------------------------------------------

-- settings: one row per key PER COMPANY (this is what lets prompts be copied)
alter table public.settings drop constraint if exists settings_key_key;
create unique index if not exists uq_settings_company_key
  on public.settings (company_id, key);

-- leads: same Apollo contact / email may exist independently in both workspaces
alter table public.leads drop constraint if exists leads_apollo_id_key;
create unique index if not exists uq_leads_company_apollo
  on public.leads (company_id, apollo_id) where apollo_id is not null;

drop index if exists public.leads_lower_email_active_uidx;
create unique index if not exists leads_company_lower_email_active_uidx
  on public.leads (company_id, lower(email))
  where is_deleted = false and email is not null;

-- organizations: the scrape cache is per-company
alter table public.organizations drop constraint if exists organizations_apollo_org_id_key;
create unique index if not exists uq_orgs_company_apollo
  on public.organizations (company_id, apollo_org_id) where apollo_org_id is not null;

drop index if exists public.organizations_domain_unique;
create unique index if not exists organizations_company_domain_unique
  on public.organizations (company_id, domain) where domain is not null;

alter table public.unenrichable_leads drop constraint if exists unenrichable_leads_apollo_id_key;
create unique index if not exists uq_unenrichable_company_apollo
  on public.unenrichable_leads (company_id, apollo_id);

-- provider_settings: PK was (provider); now one selected model per provider per company
alter table public.provider_settings drop constraint if exists provider_settings_pkey;
alter table public.provider_settings add primary key (company_id, provider);

-- llm_tier_config: was a `id boolean default true` singleton. The id column is
-- kept (harmless, still defaults true) so existing insert shapes stay valid, but
-- the row identity is now the company.
alter table public.llm_tier_config drop constraint if exists llm_tier_config_pkey;
alter table public.llm_tier_config add primary key (company_id);

-- assignment_settings: keeps its uuid id, but at most one row per company
create unique index if not exists uq_assignment_settings_company
  on public.assignment_settings (company_id);

-- assignment_cursors: PK was (lane); round-robin cursors are per-company
alter table public.assignment_cursors drop constraint if exists assignment_cursors_pkey;
alter table public.assignment_cursors add primary key (company_id, lane);

-- ---------------------------------------------------------------------------
-- 4. Constraints that stay GLOBAL on purpose
--
--    instantly_campaigns.instantly_campaign_id, reply_events.event_uid and
--    unibox_emails.instantly_email_id are identifiers minted by Instantly, not
--    by us. Both companies share one Instantly workspace, so keeping these
--    globally unique is what stops the same inbound email being ingested twice
--    (once per company). Do NOT company-scope them.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. Composite indexes for the hot per-company query paths
-- ---------------------------------------------------------------------------

create index if not exists idx_leads_company_active
  on public.leads (company_id, is_deleted, created_at desc);
create index if not exists idx_campaigns_company_active
  on public.campaigns (company_id, is_deleted, created_at desc);
create index if not exists idx_leads_company_assigned
  on public.leads (company_id, assigned_to) where is_deleted = false;
create index if not exists idx_unibox_company_thread
  on public.unibox_emails (company_id, thread_id);
