-- Migration: 2026_07_01_reply_drafts_status_check
-- Adds CHECK constraint to reply_drafts.status to prevent invalid values.
-- Only run if the constraint does not already exist.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'reply_drafts'
      AND constraint_name = 'reply_drafts_status_check'
  ) THEN
    ALTER TABLE reply_drafts
      ADD CONSTRAINT reply_drafts_status_check
      CHECK (status IN ('generating', 'draft', 'approved', 'sent', 'failed', 'rejected'));
  END IF;
END;
$$;
