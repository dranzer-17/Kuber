-- Emoji reactions on lead + campaign discussion comments.
-- Access is server-only (admin client via scoped API routes), matching
-- the parent comment tables.

create table public.lead_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.lead_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '🎉', '👀')),
  created_at timestamptz not null default now(),
  unique (comment_id, user_id, emoji)
);

create index lead_comment_reactions_comment_id_idx
  on public.lead_comment_reactions(comment_id);

alter table public.lead_comment_reactions enable row level security;
revoke all on table public.lead_comment_reactions from anon, authenticated;

comment on table public.lead_comment_reactions is
  'Emoji reactions on lead discussion comments; accessed through scoped server API routes.';

create table public.campaign_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.campaign_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '🎉', '👀')),
  created_at timestamptz not null default now(),
  unique (comment_id, user_id, emoji)
);

create index campaign_comment_reactions_comment_id_idx
  on public.campaign_comment_reactions(comment_id);

alter table public.campaign_comment_reactions enable row level security;
revoke all on table public.campaign_comment_reactions from anon, authenticated;

comment on table public.campaign_comment_reactions is
  'Emoji reactions on campaign discussion comments; accessed through scoped server API routes.';
