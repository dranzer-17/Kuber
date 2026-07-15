-- Apollo's search endpoint (free) claims a person "has_email"; the reveal
-- endpoint (bulk_match, real credits) sometimes still comes back with nothing
-- (email_status: "unavailable") — confirmed live: Apollo charges a credit for
-- that "unavailable" answer every single time you ask, and re-asking never
-- produces a different answer (it's Apollo's own data limit, not a transient
-- failure like a slow website). So email-reveal is try-once: if the one
-- attempt comes back empty, the lead is archived here — a flat table with NO
-- foreign keys into the working schema, so it never shows up in the app and
-- never costs another credit. Kept purely so its raw info (name/title/company)
-- can still be handed to the client later via a Supabase CSV export.
create table public.unenrichable_leads (
  id uuid primary key default gen_random_uuid(),
  apollo_id text not null unique,
  first_name text,
  last_name text,
  title text,
  organization_name text,
  country text,
  city text,
  state text,
  linkedin_url text,
  reason text not null default 'no_email_available',
  created_at timestamptz not null default now()
);

alter table public.unenrichable_leads enable row level security;
-- No policies: the app never queries this table (service-role admin client
-- bypasses RLS for the one place that writes to it); locked down by default
-- for anyone going through the regular client.
