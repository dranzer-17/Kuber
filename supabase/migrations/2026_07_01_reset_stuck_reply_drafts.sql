-- Migration: 2026_07_01_reset_stuck_reply_drafts
-- Creates the watchdog function that marks reply drafts stuck in 'generating'
-- for longer than N minutes as 'failed'.
-- Called at the top of /api/internal/process-reply before each run.

CREATE OR REPLACE FUNCTION reset_stuck_reply_drafts(stale_minutes int DEFAULT 5)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count int;
BEGIN
  UPDATE reply_drafts
  SET
    status     = 'failed',
    error      = 'Watchdog: generation exceeded ' || stale_minutes || ' minutes',
    updated_at = NOW()
  WHERE
    status = 'generating'
    AND created_at < NOW() - (stale_minutes || ' minutes')::interval;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

COMMENT ON FUNCTION reset_stuck_reply_drafts IS
  'Watchdog: marks reply_drafts stuck in generating state as failed. Called by process-reply route on each invocation.';
