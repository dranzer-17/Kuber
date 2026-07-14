-- Collapse territory model to india / foreign. Europe is absorbed into foreign.

update public.profiles
set territory = 'foreign'
where territory = 'europe';

alter table public.profiles drop constraint if exists profiles_territory_check;
alter table public.profiles add constraint profiles_territory_check
  check (territory in ('india','foreign'));
