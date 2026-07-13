-- §3.28 / §5 — Index hygiene from the Supabase performance advisor.

-- Drop redundant duplicate indexes (keep one of each identical pair).
DROP INDEX IF EXISTS public.idx_campaign_leads_instantly_campaign;   -- dup of campaign_leads_instantly_campaign_id_idx
DROP INDEX IF EXISTS public.idx_reply_drafts_campaign_status;        -- dup of reply_drafts_campaign_status_idx
DROP INDEX IF EXISTS public.idx_reply_drafts_event;                  -- dup of reply_drafts_reply_event_id_idx
DROP INDEX IF EXISTS public.reply_events_event_uid_unique_idx;       -- dup of reply_events_event_uid_key (constraint-backed)

-- Add covering indexes for foreign keys that lacked them (slow joins/deletes).
CREATE INDEX IF NOT EXISTS campaign_leads_draft_id_idx
  ON public.campaign_leads (draft_id);
CREATE INDEX IF NOT EXISTS email_drafts_parent_draft_id_idx
  ON public.email_drafts (parent_draft_id);
CREATE INDEX IF NOT EXISTS reply_drafts_parent_reply_draft_id_idx
  ON public.reply_drafts (parent_reply_draft_id);
CREATE INDEX IF NOT EXISTS unibox_emails_campaign_lead_id_idx
  ON public.unibox_emails (campaign_lead_id);
CREATE INDEX IF NOT EXISTS unibox_emails_reply_event_id_idx
  ON public.unibox_emails (reply_event_id);
