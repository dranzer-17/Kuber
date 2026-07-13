-- §2.5 — Atomic round-robin assignment.
--
-- The app previously read assignment_settings.round_robin_cursor, computed the next
-- employee in JS, then wrote the cursor back — a read-modify-write with no lock. Two
-- enrichments finishing at once both read the same cursor and assigned the SAME employee.
-- This function does the pick-and-advance in ONE locked statement, so it is concurrency-safe.
--
-- assignment.ts calls this RPC and only falls back to the old JS logic if the function
-- is absent (i.e. before this migration is applied).

CREATE OR REPLACE FUNCTION public.assignment_pick_round_robin(p_candidate_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings_id uuid;
  v_cursor      uuid;
  v_idx         int;
  v_next        uuid;
  v_len         int := array_length(p_candidate_ids, 1);
BEGIN
  IF v_len IS NULL OR v_len = 0 THEN
    RETURN NULL;
  END IF;

  -- Lock the singleton settings row for the duration of this transaction so
  -- concurrent callers serialize on it.
  SELECT id, round_robin_cursor
    INTO v_settings_id, v_cursor
    FROM assignment_settings
    ORDER BY updated_at DESC
    LIMIT 1
    FOR UPDATE;

  IF v_settings_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- array_position is 1-based, or NULL if the cursor isn't in the current candidate set.
  v_idx  := COALESCE(array_position(p_candidate_ids, v_cursor), 0);
  v_next := p_candidate_ids[(v_idx % v_len) + 1];

  UPDATE assignment_settings
     SET round_robin_cursor = v_next, updated_at = now()
   WHERE id = v_settings_id;

  RETURN v_next;
END;
$$;
