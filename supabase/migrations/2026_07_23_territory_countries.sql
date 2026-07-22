-- Territory becomes a LIST OF COUNTRIES instead of the india/foreign pair.
--
-- The two-bucket model made one employee ("foreign") the owner of the United
-- States, the United Kingdom, Germany, Australia, Turkey, South Africa and
-- everywhere else — roughly 1,371 of 1,602 leads. Coverage is now picked with
-- the same region/country grid the Apollo import uses, so a rep can hold
-- Western Europe, or the Middle East, or just Germany.
--
-- profiles.territory is deliberately LEFT IN PLACE and simply stops being read.
-- Dropping it here would break the deployed app between this migration landing
-- and the new code shipping, and a second developer is working in this repo
-- concurrently. Remove it in a later cleanup once this is proven in use.

alter table public.profiles
  add column if not exists territory_countries text[] not null default '{}';

comment on column public.profiles.territory_countries is
  'Canonical country names this employee receives leads for (lib/territory.ts). Empty = excluded from territory routing.';

comment on column public.profiles.territory is
  'DEPRECATED — superseded by territory_countries. No longer read by the app.';

-- Backfill so routing on deploy day is IDENTICAL to the day before:
--   india reps keep India and nothing else,
--   foreign reps get every other country the picker knows.
-- Baseline to re-check after this runs: India (231 leads) -> Kavish, Rudraksh;
-- everything else (1,371) -> Rahil.
update public.profiles
set territory_countries = array['India']
where role = 'employee' and territory = 'india';

update public.profiles
set territory_countries = array[
  'Afghanistan', 'Albania', 'Algeria', 'Angola', 'Argentina', 'Armenia', 'Aruba', 'Australia',
  'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium',
  'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei',
  'Bulgaria', 'Burkina Faso', 'Cambodia', 'Cameroon', 'Canada', 'Cape Verde', 'Chile', 'China',
  'Colombia', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark',
  'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Estonia', 'Eswatini', 'Ethiopia',
  'Fiji', 'Finland', 'France', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Guatemala',
  'Guernsey', 'Guinea', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland',
  'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan',
  'Jersey', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon',
  'Lesotho', 'Liberia', 'Libya', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia',
  'Maldives', 'Mali', 'Malta', 'Mexico', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco',
  'Mozambique', 'Myanmar', 'Namibia', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger',
  'Nigeria', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palestine', 'Panama',
  'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Puerto Rico',
  'Qatar', 'Romania', 'Russia', 'Rwanda', 'Samoa', 'Saudi Arabia', 'Senegal', 'Serbia',
  'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia',
  'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden',
  'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo',
  'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Uganda', 'Ukraine',
  'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu',
  'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'
]
where role = 'employee' and territory in ('foreign', 'europe');

-- Managers never receive routed leads; keep them explicitly empty.
update public.profiles set territory_countries = '{}' where role <> 'employee';

create index if not exists profiles_territory_countries_idx
  on public.profiles using gin (territory_countries);
