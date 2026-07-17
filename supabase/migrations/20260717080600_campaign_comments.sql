-- Internal discussion thread attached to a campaign.
-- Access is server-only: route handlers authenticate each request and apply
-- the application's campaign access scope before using the admin client.
create table public.campaign_comments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index campaign_comments_campaign_id_created_at_idx
  on public.campaign_comments(campaign_id, created_at asc);

create index campaign_comments_author_id_idx
  on public.campaign_comments(author_id);

alter table public.campaign_comments enable row level security;

revoke all on table public.campaign_comments from anon, authenticated;

comment on table public.campaign_comments is
  'Internal manager/employee discussion attached to a campaign; accessed through scoped server API routes.';
