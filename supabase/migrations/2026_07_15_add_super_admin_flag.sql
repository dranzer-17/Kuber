alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

update public.profiles
  set is_super_admin = true
  where email = 'kuber@admin.com';
