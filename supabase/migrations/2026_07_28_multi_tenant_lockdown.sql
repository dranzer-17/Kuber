-- Close the two holes the multi-tenant work itself opened.
--
-- The app's security model (established in 2026_07_14_enable_rls.sql) is:
-- RLS ON with ZERO policies on every table, so the anon/authenticated keys can
-- read nothing at all and the service-role client used by the API routes is the
-- only way in. Tenant isolation then rides on the company-scoped client
-- (lib/supabase/scoped.ts). Both fixes below restore that baseline.

-- 1. `companies` was created without RLS, which — unlike every other table —
--    left it readable through PostgREST with the publishable anon key. That
--    exposes the tenant list (names + slugs). Deny-all, same as the rest.
alter table public.companies enable row level security;

-- 2. assignment_pick_round_robin was DROPped and recreated with a new signature
--    (it gained p_company_id), and a freshly created function grants EXECUTE to
--    PUBLIC by default. Left as-is, any anon caller could spin another
--    company's round-robin cursor and skew who gets assigned the next lead.
--    Only the service role should ever call it.
revoke execute on function public.assignment_pick_round_robin(uuid, text, uuid[], integer) from public;
revoke execute on function public.assignment_pick_round_robin(uuid, text, uuid[], integer) from anon;
revoke execute on function public.assignment_pick_round_robin(uuid, text, uuid[], integer) from authenticated;
grant  execute on function public.assignment_pick_round_robin(uuid, text, uuid[], integer) to service_role;
