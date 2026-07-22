-- Background job tracking for bulk draft regeneration.
--
-- Regenerating one draft is a single LLM call taking several seconds, so a
-- 200-lead campaign is 15-25 minutes of work. That cannot run inside one
-- request (nor on the client, which is what retryFailedDrafts used to do and
-- which dies the moment the tab closes). These two tables let the batch worker
-- self-chain across many short invocations, report exact progress, resume after
-- a crash, and be cancelled mid-flight.
--
-- Access is intentionally server-only: API routes authenticate users and apply
-- the same lead-assignment scope used by the rest of the application.
create table public.draft_regeneration_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  step_number int not null default 1,
  custom_instruction text,
  status text not null default 'queued'
    check (status in ('queued','running','completed','cancelled','failed')),
  total int not null default 0,
  succeeded int not null default 0,
  failed int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- Bumped at the end of every batch. A 'running' job whose heartbeat has gone
  -- stale lost its after() self-chain (this happens in practice) and is revived
  -- by the enrichment watchdog.
  heartbeat_at timestamptz
);

-- One row per targeted lead. Progress is counted from these rather than derived
-- from email_drafts: once some leads have failed, "what still looks
-- un-regenerated" is ambiguous, but a pending item is not.
create table public.draft_regeneration_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.draft_regeneration_jobs(id) on delete cascade,
  campaign_lead_id uuid not null references public.campaign_leads(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','running','done','failed','skipped')),
  error text,
  updated_at timestamptz not null default now()
);

create index draft_regen_jobs_campaign_created_idx
  on public.draft_regeneration_jobs(campaign_id, created_at desc);

create index draft_regen_items_job_status_idx
  on public.draft_regeneration_job_items(job_id, status);

-- At most one live job per campaign+step, so a double-click or a second user
-- cannot start two runs that race each other over the same drafts.
create unique index uq_draft_regen_active_job
  on public.draft_regeneration_jobs(campaign_id, step_number)
  where status in ('queued','running');

-- A lead can only be targeted once within a job.
create unique index uq_draft_regen_item_per_job
  on public.draft_regeneration_job_items(job_id, campaign_lead_id);

alter table public.draft_regeneration_jobs enable row level security;
alter table public.draft_regeneration_job_items enable row level security;

comment on table public.draft_regeneration_jobs is
  'Background bulk draft-regeneration runs for a campaign; accessed through scoped server API routes.';
comment on table public.draft_regeneration_job_items is
  'Per-lead work items of a bulk draft-regeneration run; drives progress, resume and cancel.';
