-- §1.5 / §1.6 / §3.22 — columns and constraints backing the code fixes.

-- 1) Campaign send lock (§1.5) — makes sendCampaign's double-send guard real.
--    The code degrades to "no lock" until this column exists, so it is safe to
--    deploy the code first and run this after.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS send_lock_at timestamptz;

-- 2) Sub-campaign failure detail (§1.5) — the fan-out failure path writes last_error;
--    without this column that write silently failed (and took the status update with it).
ALTER TABLE public.instantly_campaigns
  ADD COLUMN IF NOT EXISTS last_error text;

-- 3) Reply attribution (§1.6) — one active lead per email, case-insensitive.
--    Prevents the duplicate/case-mismatch rows that made replies vanish.
--    NOTE: if this errors, duplicate active emails already exist. Find them with:
--      SELECT lower(email), count(*) FROM leads
--      WHERE is_deleted = false AND email IS NOT NULL
--      GROUP BY lower(email) HAVING count(*) > 1;
--    Resolve (merge/soft-delete) the dupes, then re-run.
CREATE UNIQUE INDEX IF NOT EXISTS leads_lower_email_active_uidx
  ON public.leads (lower(email))
  WHERE is_deleted = false AND email IS NOT NULL;

-- 4) CHECK constraints on the free-text status columns (§3.22). Added NOT VALID so
--    existing rows aren't re-checked (only new/updated rows are enforced). VALIDATE
--    separately once you've confirmed existing data conforms.
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_chk
  CHECK (status IN ('draft','processing','active','paused','completed')) NOT VALID;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_send_mode_chk
  CHECK (send_mode IN ('now','scheduled')) NOT VALID;

ALTER TABLE public.email_drafts
  ADD CONSTRAINT email_drafts_status_chk
  CHECK (status IN ('generating','draft','approved','rejected','sent','failed')) NOT VALID;

ALTER TABLE public.unibox_emails
  ADD CONSTRAINT unibox_emails_direction_chk
  CHECK (direction IN ('sent','received')) NOT VALID;

-- After confirming existing rows conform, enforce for the whole table:
--   ALTER TABLE public.campaigns     VALIDATE CONSTRAINT campaigns_status_chk;
--   ALTER TABLE public.campaigns     VALIDATE CONSTRAINT campaigns_send_mode_chk;
--   ALTER TABLE public.email_drafts  VALIDATE CONSTRAINT email_drafts_status_chk;
--   ALTER TABLE public.unibox_emails VALIDATE CONSTRAINT unibox_emails_direction_chk;
