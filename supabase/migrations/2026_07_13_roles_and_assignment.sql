-- Role-based access: profiles, assignment settings, lead assignment
create table if not exists public.profiles (
  id uuid primary key,
  email text not null,
  full_name text,
  role text not null check (role in ('manager', 'employee')),
  territory text check (territory in ('india', 'foreign')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.assignment_settings (
  id uuid primary key default gen_random_uuid(),
  strategy text not null default 'manual' check (strategy in ('round_robin', 'territory', 'manual')),
  round_robin_cursor uuid,
  updated_at timestamptz not null default now()
);

alter table public.leads
  add column if not exists assigned_to uuid references public.profiles(id),
  add column if not exists assigned_at timestamptz;

create index if not exists idx_leads_assigned_to on public.leads(assigned_to);
create index if not exists idx_campaigns_created_by on public.campaigns(created_by);

-- Seed: existing single admin user becomes the first Manager
insert into public.profiles (id, email, full_name, role, is_active)
select id, email, 'Manager', 'manager', true
from auth.users
where raw_app_meta_data->>'role' = 'admin'
on conflict (id) do nothing;

update auth.users
set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', 'manager')
where raw_app_meta_data->>'role' = 'admin';

-- Singleton assignment strategy row
insert into public.assignment_settings (strategy)
select 'manual'
where not exists (select 1 from public.assignment_settings);
