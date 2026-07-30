-- Fix: Apollo lead import failing with "no unique or exclusion constraint
-- matching the ON CONFLICT specification" (broke a live client demo).
--
-- 2026_07_28_multi_tenant_companies.sql replaced the old global unique
-- constraint on leads.apollo_id with a PARTIAL unique index:
--   create unique index uq_leads_company_apollo
--     on leads (company_id, apollo_id) where apollo_id is not null;
--
-- Postgres will only use a partial index as an ON CONFLICT arbiter if the
-- INSERT's ON CONFLICT clause repeats that same predicate. supabase-js's
-- `.upsert(rows, { onConflict: "apollo_id" })` (scoped to
-- "company_id,apollo_id" by lib/supabase/scoped.ts) has no way to add a
-- predicate, so Postgres can't pick an arbiter at all and the whole batch
-- insert fails.
--
-- The partial predicate bought nothing anyway: Postgres unique indexes
-- already treat NULLs as distinct from each other, so a plain (non-partial)
-- unique index still allows unlimited manual-entry leads with a null
-- apollo_id per company. Applying the same fix to organizations.apollo_org_id
-- for consistency, even though no current upsert call site targets it yet.

drop index if exists public.uq_leads_company_apollo;
create unique index if not exists uq_leads_company_apollo
  on public.leads (company_id, apollo_id);

drop index if exists public.uq_orgs_company_apollo;
create unique index if not exists uq_orgs_company_apollo
  on public.organizations (company_id, apollo_org_id);
