-- Migration: 2026_07_01_increment_campaign_counter
-- Creates the increment_campaign_counter() function used by classify-reply.ts
-- and the webhook handler to increment hot_count, cold_count, and replied_count.
-- This function was missing, causing all counter increments to silently fail.

CREATE OR REPLACE FUNCTION increment_campaign_counter(
  p_campaign_id uuid,
  p_column      text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Whitelist the columns that are allowed to be incremented to prevent SQL injection.
  IF p_column NOT IN ('hot_count', 'cold_count', 'replied_count', 'sent_count', 'opened_count') THEN
    RAISE EXCEPTION 'increment_campaign_counter: invalid column "%"', p_column;
  END IF;

  EXECUTE format(
    'UPDATE campaigns SET %I = COALESCE(%I, 0) + 1, updated_at = NOW() WHERE id = $1',
    p_column,
    p_column
  ) USING p_campaign_id;
END;
$$;

-- Verify after applying:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name = 'increment_campaign_counter';
