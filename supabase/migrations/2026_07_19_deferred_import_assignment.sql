-- Deferred assignment: the manager's import-time choice is REMEMBERED on the
-- import instead of applied on the spot. Leads are only actually assigned once
-- they're workable (enriched / input_required-with-email), so employees never
-- receive raw "New" shells that might still get archived out from under them.
alter table public.imports
  add column if not exists assignment_strategy text
    check (assignment_strategy in ('manual','round_robin','territory')),
  add column if not exists assignment_target uuid references public.profiles(id);
