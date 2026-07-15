-- Per-lead activity feed (created / enriched / assigned / added-to-campaign /
-- draft-sent / reply ...). Distinct from enrichment_logs, which is a raw
-- technical/debug trail of the org scrape pipeline (full of HTTP 402 dumps not
-- meant for the lead drawer). This is the clean, human-readable timeline.
create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event text not null,
  detail text,
  actor_id uuid references public.profiles(id),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index lead_events_lead_id_created_at_idx
  on public.lead_events(lead_id, created_at desc);

alter table public.lead_events enable row level security;
-- Read/write goes through the service-role admin client (with its own scope
-- checks in the route), so no policies for the regular client — locked down.
