-- Split the existing single workspace into two tenants.
--
--   Company A (dev)  keeps every lead, organization, campaign, draft and log
--                    that exists today, plus the four gmail dev accounts.
--   Company B (Kuber Polyplast) is the handover workspace: ZERO pipeline data
--                    by construction (it is a brand-new tenant, nothing to
--                    delete), with configuration copied across so the client
--                    opens a working app rather than an empty one.
--
-- The five client accounts move OUT of the dev workspace. A Supabase user has
-- one email and therefore one company, so this is a move, not a duplication.

-- ---------------------------------------------------------------------------
-- 1. Make the vault-secret delete trigger refcount-aware
--
--    Company A and Company B share the same vault secrets (one real Apollo /
--    Instantly / Firecrawl key each). The original trigger dropped the vault
--    secret unconditionally on row delete, so Company A deleting its key row
--    would silently break Company B: the provider_keys row would survive but
--    provider_key_read_secret() would return null and enrichment would fail
--    with a confusing "no key" error. Only drop the secret once the last
--    referencing row is gone.
-- ---------------------------------------------------------------------------

create or replace function public.provider_keys_delete_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if not exists (
    select 1 from public.provider_keys
    where secret_vault_id = old.secret_vault_id and id <> old.id
  ) then
    delete from vault.secrets where id = old.secret_vault_id;
  end if;
  return old;
end;
$$;

-- Key lookup is always company-scoped now.
drop index if exists public.provider_keys_provider_priority_idx;
create index if not exists provider_keys_company_provider_priority_idx
  on public.provider_keys (company_id, provider, is_active, priority);

-- ---------------------------------------------------------------------------
-- 2. Move the five client accounts into Company B
-- ---------------------------------------------------------------------------

update public.profiles
set company_id = '00000000-0000-0000-0000-00000000000b'
where email in (
  'kuber@admin.com',
  'ashish.sharma@kuberpolyplast.com',
  'ankit.singh@kuberpolyplast.com',
  'venkatesh.p@kuberpolyplast.com',
  'prince.soni@kuberpolyplast.com'
);

-- Per-user config follows its owner (this carries the "Kuber Polyplast Sales
-- Team" signature into Company B).
update public.user_settings us
set company_id = p.company_id
from public.profiles p where p.id = us.user_id and us.company_id <> p.company_id;

update public.user_signatures usg
set company_id = p.company_id
from public.profiles p where p.id = usg.user_id and usg.company_id <> p.company_id;

-- kuber@admin.com was the only super admin and has left for Company B, so the
-- dev workspace would be left with none. Promote the remaining active dev
-- manager. Change this if a different dev should hold the keys.
update public.profiles
set is_super_admin = true
where email = 'lakshit@gmail.com';

-- ---------------------------------------------------------------------------
-- 3. Copy configuration Company A -> Company B
--
--    Prompts, product sections, email templates, signature fields and industry
--    context are copied verbatim: the existing values already describe Kuber
--    Polyplast, so Company B wants exactly them.
--
--    Deliberately NOT copied:
--      unibox_sync_state  — an Instantly sync cursor; B must start from scratch
--                           or it would skip every email before the handover.
--      credit_check_*     — cached provider credit readings; runtime state that
--                           B refetches on first use.
-- ---------------------------------------------------------------------------

insert into public.settings (company_id, key, value)
select '00000000-0000-0000-0000-00000000000b', s.key, s.value
from public.settings s
where s.company_id = '00000000-0000-0000-0000-00000000000a'
  and s.key <> 'unibox_sync_state'
  and s.key not like 'credit_check_%'
on conflict (company_id, key) do nothing;

insert into public.product_offerings (company_id, name, description, hint, sort_order)
select '00000000-0000-0000-0000-00000000000b', po.name, po.description, po.hint, po.sort_order
from public.product_offerings po
where po.company_id = '00000000-0000-0000-0000-00000000000a';

-- Shared provider keys: same vault secrets, independent health state so one
-- company cooling off a key does not stall the other.
insert into public.provider_keys
  (company_id, provider, label, secret_vault_id, secret_last4, priority, is_active, status, created_by)
select
  '00000000-0000-0000-0000-00000000000b',
  pk.provider, pk.label, pk.secret_vault_id, pk.secret_last4, pk.priority, pk.is_active,
  'healthy',
  (select id from public.profiles where email = 'kuber@admin.com')
from public.provider_keys pk
where pk.company_id = '00000000-0000-0000-0000-00000000000a';

insert into public.provider_settings (company_id, provider, selected_model, updated_by)
select '00000000-0000-0000-0000-00000000000b', ps.provider, ps.selected_model,
       (select id from public.profiles where email = 'kuber@admin.com')
from public.provider_settings ps
where ps.company_id = '00000000-0000-0000-0000-00000000000a'
on conflict (company_id, provider) do nothing;

insert into public.llm_tier_config (company_id, id, primary_provider, fallback_provider, updated_by)
select '00000000-0000-0000-0000-00000000000b', true, ltc.primary_provider, ltc.fallback_provider,
       (select id from public.profiles where email = 'kuber@admin.com')
from public.llm_tier_config ltc
where ltc.company_id = '00000000-0000-0000-0000-00000000000a'
on conflict (company_id) do nothing;

insert into public.assignment_settings (company_id, strategy)
select '00000000-0000-0000-0000-00000000000b', a.strategy
from public.assignment_settings a
where a.company_id = '00000000-0000-0000-0000-00000000000a'
on conflict do nothing;
