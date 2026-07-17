-- Lets a super-admin pick which LLM provider is tried first ("Primary") and
-- second ("Fallback") in complete()'s tier order — previously fixed in code
-- (LLM_TIER_ORDER in lib/services/providers/registry.ts). Providers beyond
-- these two still get tried, in their existing default relative order, as
-- tier 3+ — this only reorders the front of the list, it doesn't shrink it.
--
-- Singleton-row trick: `id boolean primary key` + `check (id)` means only
-- one row can ever exist (id must be literally `true`), so callers always
-- upsert onConflict "id" against the same row without a separate
-- does-a-row-exist check.
create table public.llm_tier_config (
  id                boolean primary key default true,
  primary_provider  text,
  fallback_provider text,
  updated_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  constraint llm_tier_config_singleton check (id)
);

insert into public.llm_tier_config (id) values (true);

alter table public.llm_tier_config enable row level security;
-- Zero policies, matching provider_keys/provider_settings — service-role
-- client only, enforced by requireSuperAdmin() in the API route.
