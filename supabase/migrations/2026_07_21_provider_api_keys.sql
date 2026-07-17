-- Multi-provider API key management (Settings > Keys, super-admin only).
--
-- `provider` is a plain text column with NO check constraint — provider ids
-- are validated against the code-side registry (lib/services/providers/registry.ts),
-- not the database, so adding a new provider is a code change only, never a
-- migration (the "factory method" extensibility the feature was built for).
--
-- Secrets are stored in Supabase Vault (supabase_vault extension, already
-- installed) rather than a custom app-level cipher — `secret_vault_id` is a
-- reference into vault.secrets, decrypted on read via vault.decrypted_secrets.
-- Vault's tables/views live in the `vault` schema, which PostgREST does not
-- expose by default, so three SECURITY DEFINER wrapper functions below give
-- application code (via the service-role client only) a way to create/read/
-- delete a secret without granting broader access to the `vault` schema.

create table public.provider_keys (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,
  label              text not null,
  secret_vault_id    uuid not null,                  -- vault.secrets.id — the actual key never lives in this table
  secret_last4       text not null,                  -- masked display only, captured once at insert from the plaintext
  priority           integer not null default 100,   -- lower = tried first; ties broken by created_at
  is_active          boolean not null default true,  -- admin on/off switch, independent of health status
  status             text not null default 'healthy' check (status in ('healthy', 'cooling_off', 'dead')),
  cooling_off_until  timestamptz,
  last_used_at       timestamptz,
  last_checked_at    timestamptz,
  last_error         text,
  last_error_at      timestamptz,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index provider_keys_provider_priority_idx
  on public.provider_keys (provider, is_active, priority);

create table public.provider_settings (
  provider       text primary key,
  selected_model text,                                -- null = caller falls back to env var, then a hardcoded default
  updated_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now()
);

alter table public.provider_keys enable row level security;
alter table public.provider_settings enable row level security;
-- Zero policies on both, matching the existing `settings` table pattern
-- (see 2026_07_14_enable_rls.sql) — service-role client only, enforced by
-- requireSuperAdmin() in the API routes, not by RLS.

-- Deleting a key removes its Vault secret too, so `vault.secrets` never
-- accumulates orphaned rows if a key is deleted by any path (API route,
-- direct SQL, future admin tooling) rather than relying on every caller to
-- remember a two-step delete.
create or replace function public.provider_keys_delete_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets where id = old.secret_vault_id;
  return old;
end;
$$;

create trigger provider_keys_delete_vault_secret_trigger
  after delete on public.provider_keys
  for each row execute function public.provider_keys_delete_vault_secret();

-- Wrapper RPCs: application code never touches the `vault` schema directly.
create or replace function public.provider_key_create_secret(p_secret text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  v_id := vault.create_secret(p_secret, p_name);
  return v_id;
end;
$$;

create or replace function public.provider_key_read_secret(p_vault_id uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_vault_id;
$$;

revoke execute on function public.provider_key_create_secret(text, text) from public;
revoke execute on function public.provider_key_read_secret(uuid) from public;
grant execute on function public.provider_key_create_secret(text, text) to service_role;
grant execute on function public.provider_key_read_secret(uuid) to service_role;
