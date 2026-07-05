-- Unibox: local mirror of Instantly Email entities (RLS intentionally off — service role only)

CREATE TABLE IF NOT EXISTS unibox_emails (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instantly_email_id     text NOT NULL UNIQUE,
  thread_id              text,
  message_id             text,
  direction              text NOT NULL,
  ue_type                integer,
  subject                text,
  from_email             text,
  to_emails              text,
  cc_emails              text,
  bcc_emails              text,
  body_text              text,
  body_html              text,
  content_preview        text,
  eaccount               text,
  lead_email             text,
  instantly_lead_id      text,
  instantly_campaign_id  text,
  campaign_id            uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_lead_id       uuid REFERENCES campaign_leads(id) ON DELETE SET NULL,
  reply_event_id         uuid REFERENCES reply_events(id) ON DELETE SET NULL,
  step                   text,
  is_unread              boolean NOT NULL DEFAULT false,
  is_auto_reply          boolean NOT NULL DEFAULT false,
  is_focused             boolean NOT NULL DEFAULT true,
  i_status               integer,
  ai_interest_value      numeric,
  attachment_json        jsonb,
  timestamp_email        timestamptz NOT NULL,
  timestamp_created      timestamptz,
  synced_at              timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz
);

CREATE INDEX IF NOT EXISTS idx_unibox_emails_thread ON unibox_emails (thread_id);
CREATE INDEX IF NOT EXISTS idx_unibox_emails_lead ON unibox_emails (lead_email);
CREATE INDEX IF NOT EXISTS idx_unibox_emails_campaign ON unibox_emails (campaign_id);
CREATE INDEX IF NOT EXISTS idx_unibox_emails_eaccount ON unibox_emails (eaccount);
CREATE INDEX IF NOT EXISTS idx_unibox_emails_ts ON unibox_emails (timestamp_email DESC);
CREATE INDEX IF NOT EXISTS idx_unibox_emails_unread ON unibox_emails (is_unread) WHERE is_unread;
CREATE INDEX IF NOT EXISTS idx_unibox_emails_tscreated ON unibox_emails (timestamp_created);

ALTER TABLE unibox_emails ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(subject,'') || ' ' || coalesce(body_text,'') || ' ' ||
      coalesce(lead_email,'') || ' ' || coalesce(from_email,''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_unibox_emails_tsv ON unibox_emails USING gin (search_tsv);
