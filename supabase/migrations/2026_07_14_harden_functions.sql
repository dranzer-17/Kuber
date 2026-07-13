-- Function hardening (applied 2026-07-14).
--
-- 1) assignment_pick_round_robin is SECURITY DEFINER (it must update assignment_settings
--    under RLS). With RLS now enabled, a SECURITY DEFINER function in the exposed public
--    schema is callable by anon/authenticated via /rest/v1/rpc. Restrict EXECUTE to the
--    service role (the app) so the browser can't invoke it.
REVOKE EXECUTE ON FUNCTION public.assignment_pick_round_robin(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.assignment_pick_round_robin(uuid[]) TO service_role;

-- 2) Pin search_path on the two functions flagged by security lint 0011 (§28).
ALTER FUNCTION public.increment_campaign_counter(uuid, text) SET search_path = public;
ALTER FUNCTION public.reset_stuck_reply_drafts(integer)      SET search_path = public;
