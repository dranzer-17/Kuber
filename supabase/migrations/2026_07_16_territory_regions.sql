-- Territory model becomes india / europe / foreign (Phase 0.3 / Phase 4, Q8).
-- Existing 'india'/'foreign' rows remain valid.

alter table public.profiles drop constraint if exists profiles_territory_check;
alter table public.profiles add constraint profiles_territory_check
  check (territory in ('india','europe','foreign'));
