-- Move genuinely cross-tenant runtime state out of the now company-scoped
-- `settings` table.
--
-- Two key families were never per-company configuration — they are process
-- state that happens to have been parked in `settings`:
--
--   unibox_sync_state  The Instantly mailbox cursor. Both companies share ONE
--                      Instantly workspace and runUniboxSync does ONE pass over
--                      it, so there is exactly one cursor. Per-company cursors
--                      would make each tenant re-pull the same mailbox.
--   credit_check_*     Cached provider credit/balance readings. The provider
--                      keys are shared between companies, so the balance behind
--                      them is a single global number.
--
-- After the multi-tenant migration both were broken, not merely untidy: they are
-- written through the UNSCOPED admin client (the enrichment relay and the unibox
-- cron have no user and therefore no company), so every write sent a null
-- company_id into a NOT NULL column, and `onConflict: "key"` no longer matched
-- any unique constraint once the index became (company_id, key). Reads were
-- equally wrong — a bare `.eq("key", ...).maybeSingle()` would return the other
-- tenant's row today and throw outright once both tenants had one.
--
-- A table with no company_id at all states the intent directly and cannot drift
-- back into per-tenant semantics by accident.

create table if not exists public.system_state (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

comment on table public.system_state is
  'Cross-tenant process state (Instantly sync cursor, cached provider credit readings). Deliberately has NO company_id — these values are global because the Instantly workspace and the provider keys are shared. Per-company configuration belongs in `settings`.';

-- Same posture as every other table: RLS on, zero policies, service-role only.
alter table public.system_state enable row level security;

-- Carry the existing values over so the unibox sync resumes from its current
-- cursor instead of re-ingesting the whole mailbox. Company A holds the only
-- copies (Company B was seeded without them, deliberately).
insert into public.system_state (key, value, updated_at)
select s.key, s.value, s.updated_at
from public.settings s
where s.key = 'unibox_sync_state' or s.key like 'credit_check_%'
on conflict (key) do nothing;

delete from public.settings
where key = 'unibox_sync_state' or key like 'credit_check_%';
