-- Campaign-level assignment (Phase 0.2 / Phase 2 of planning.md).
-- A campaign has at most ONE current assignee (campaigns.assigned_to);
-- campaign_assignments is an append-only history so reassignment is auditable.

alter table public.campaigns
  add column if not exists assigned_to uuid references public.profiles(id),
  add column if not exists assigned_at timestamptz;

create index if not exists idx_campaigns_assigned_to on public.campaigns(assigned_to);

create table if not exists public.campaign_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  assigned_to uuid references public.profiles(id),   -- null = returned to pool
  assigned_by uuid not null,
  previous_assignee uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_campaign_assignments_campaign
  on public.campaign_assignments(campaign_id, created_at desc);

alter table public.campaign_assignments enable row level security;
