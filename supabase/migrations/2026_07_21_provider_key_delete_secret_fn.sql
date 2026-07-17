-- Standalone secret-delete wrapper (the existing trigger from
-- 2026_07_21_provider_api_keys.sql only fires on provider_keys row
-- deletion) -- needed so a failed insert into provider_keys can roll back
-- the vault secret it already created.
create or replace function public.provider_key_delete_secret(p_vault_id uuid)
returns void
language sql
security definer
set search_path = public, vault
as $$
  delete from vault.secrets where id = p_vault_id;
$$;

revoke execute on function public.provider_key_delete_secret(uuid) from public;
grant execute on function public.provider_key_delete_secret(uuid) to service_role;
