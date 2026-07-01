-- Migration: 2026_07_01_add_reply_subject
-- Adds reply_subject column to reply_events table.
-- Used by the webhook handler and process-reply worker for threading context.

ALTER TABLE reply_events
  ADD COLUMN IF NOT EXISTS reply_subject text;

COMMENT ON COLUMN reply_events.reply_subject IS
  'Subject line of the inbound reply email. Used by the AI drafter for threading context.';
