-- Internal discussion thread attached to a lead.
-- Access is intentionally server-only: API routes authenticate users and
-- apply the same lead-assignment scope used by the rest of the application.
create table public.lead_comments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index lead_comments_lead_id_created_at_idx
  on public.lead_comments(lead_id, created_at asc);

alter table public.lead_comments enable row level security;

comment on table public.lead_comments is
  'Internal manager/employee discussion attached to a lead; accessed through scoped server API routes.';
