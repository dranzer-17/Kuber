-- Move the two sub-hourly background jobs off GitHub Actions onto pg_cron.
--
-- GitHub's `schedule` trigger is best effort and drops ticks under load, and it
-- punishes short intervals hardest. Measured on 2026-07-23: the enrichment
-- watchdog asked for */15 and got 10 runs with gaps of 67-212 minutes (~130 min
-- average, i.e. about 14% of the intended rate), and Unibox sync asked for */5
-- and then */15 and had run exactly ZERO times since being added. Those two are
-- the jobs whose whole value is a bounded worst case, so an unbounded scheduler
-- makes them pointless. The database is always awake and is not queued behind
-- other tenants' CI, so it actually fires on time.
--
-- Deliberately NOT moved:
--   * auto-retry-failed-orgs (0 */3) — 3-hourly is loose enough that GitHub
--     hits it reliably, and it is already working there.
--   * reconcile-counters (daily) — stays on Vercel Cron via vercel.json.
--
-- The secret is not in this file. Both values live in Supabase Vault, seeded
-- out of band because this repo is public:
--   select vault.create_secret('<INTERNAL_SECRET>',  'internal_secret', '...');
--   select vault.create_secret('https://your.app',   'app_base_url',    '...');
-- Rotating either one is an update to the vault row, with no migration and no
-- redeploy. cron.job stores its command in plaintext, so reading the secret at
-- call time instead of inlining it keeps it out of that table.

create extension if not exists pg_cron;
create extension if not exists pg_net;

/**
 * POSTs to one of this app's internal routes with the x-internal-secret header
 * the route expects. net.http_post is async: it queues the request and returns
 * an id, so the response lands in net._http_response rather than here.
 *
 * p_timeout_ms must clear the route's own runtime or pg_net drops the connection
 * mid-flight and the job looks like it failed when it was merely slow. The first
 * run of this proved the point: unibox/sync spent 14.9s in request/response and
 * tripped a 15s timeout, so it gets a window matching its maxDuration = 55.
 */
create or replace function public.ping_internal_route(
  p_path       text,
  p_timeout_ms integer default 15000
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  v_base   text;
  v_id     bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'internal_secret';
  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'app_base_url';
  if v_secret is null or v_base is null then
    raise exception 'ping_internal_route: vault secrets internal_secret and app_base_url must both exist';
  end if;

  select net.http_post(
    url     := v_base || p_path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    timeout_milliseconds := p_timeout_ms
  ) into v_id;

  return v_id;
end;
$$;

-- security definer + reads a secret + can POST to any internal route, so this
-- must never be reachable from the anon/authenticated API roles: that would let
-- any logged-in user drive the internal job endpoints. Only the cron owner runs it.
revoke all on function public.ping_internal_route(text, integer) from public;
revoke all on function public.ping_internal_route(text, integer) from anon, authenticated, service_role;

-- cron.schedule upserts on job name, so re-running this migration re-points the
-- existing jobs rather than stacking duplicates.
select cron.schedule(
  'enrichment-watchdog',
  '*/15 * * * *',
  $$select public.ping_internal_route('/api/internal/enrichment-watchdog')$$
);

select cron.schedule(
  'unibox-sync',
  '*/15 * * * *',
  $$select public.ping_internal_route('/api/v1/unibox/sync', 60000)$$
);
