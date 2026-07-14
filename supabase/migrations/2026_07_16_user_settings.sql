-- Per-user configuration layer (Phase 0.1 / Phase 1 of planning.md).
-- Each column is nullable: NULL means "inherit the company-wide default"
-- from the `settings` table. Replaces the dead `user_signatures` table
-- (kept for now; dropped in a later cleanup once verified in prod).

-- Generic updated_at maintainer, reused by later migrations.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.user_settings (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  draft_prompt text,
  reply_prompt text,
  signature    text,
  sender_name  text,
  theme        text check (theme in ('monochrome','blue','green','purple','orange','rose')),
  theme_mode   text check (theme_mode in ('dark','light')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- Seed a row per existing profile so the current global theme carries over
-- (nobody's UI flips on deploy) and migrate the old user_signatures content.
insert into public.user_settings (user_id, signature, theme, theme_mode)
select
  p.id,
  nullif(btrim(concat_ws(E'\n', us.full_name, us.title, us.contact)), ''),
  (select value from public.settings where key = 'theme'
     and value in ('monochrome','blue','green','purple','orange','rose')),
  (select value from public.settings where key = 'theme_mode'
     and value in ('dark','light'))
from public.profiles p
left join public.user_signatures us on us.user_id = p.id
on conflict (user_id) do nothing;
