-- §1.10 / §2.1 — Enable Row Level Security on every public table.
--
-- WHY THIS IS SAFE HERE:
--   The app talks to Postgres ONLY through the service-role client (createAdminClient),
--   and the service role BYPASSES RLS. The browser bundle uses the anon key for AUTH
--   ONLY (supabase.auth.*) — it never reads/writes tables directly (verified).
--   Therefore enabling RLS with NO policies = the API keeps working, while the public
--   anon key can no longer read/write these tables directly via PostgREST.
--
-- Before this, anyone with the publishable/anon key (it ships in the browser) could
-- read or modify every row — including leads' PII, email bodies, settings, AND the
-- `profiles` table that the whole RBAC trusts (an employee could self-promote to
-- manager). This closes that hole.
--
-- If you later need the browser to read a table directly, add an explicit policy
-- for the `authenticated` role to THAT table — do not disable RLS again.

ALTER TABLE public.organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_drafts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_leads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reply_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_signatures     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instantly_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_steps      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_offerings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unibox_emails       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_settings ENABLE ROW LEVEL SECURITY;

-- Verify (should report rowsecurity = true for all):
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relname;
