-- Round-robin must ROTATE, not backfill whoever is least loaded.
--
-- The JS picker this replaces chose the employee with the fewest leads and kept
-- choosing them until they caught up with the next-lowest, so a small batch
-- landed entirely on one person: 3 leads across 3 employees whose books differ
-- by more than 3 went 3-0-0. Round robin here means even division — 6 leads
-- across 3 employees is 2 each, 8 is 3/3/2 — with the remainder falling to
-- whoever the cursor reaches first. Historical load is deliberately NOT
-- consulted; rotation keeps books even on its own over time.
--
-- Each lane rotates independently so India and foreign neither share a cursor
-- nor block each other's picks, and so consecutive batches continue where the
-- last one stopped instead of restarting at the first employee every time.
-- Territory never narrows the candidate set for the 'global' (round_robin) lane.

CREATE TABLE IF NOT EXISTS public.assignment_cursors (
  lane            text PRIMARY KEY,
  cursor_employee uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- No policies: service_role bypasses RLS and is the only intended caller.
ALTER TABLE public.assignment_cursors ENABLE ROW LEVEL SECURITY;

-- Carry the old singleton cursor over as the global lane's starting point.
INSERT INTO public.assignment_cursors (lane, cursor_employee)
SELECT 'global', round_robin_cursor
  FROM public.assignment_settings
 ORDER BY updated_at DESC
 LIMIT 1
ON CONFLICT (lane) DO NOTHING;

INSERT INTO public.assignment_cursors (lane) VALUES ('global'), ('india'), ('foreign')
ON CONFLICT (lane) DO NOTHING;

-- Replaced by the lane-aware, batch-capable version below.
DROP FUNCTION IF EXISTS public.assignment_pick_round_robin(uuid[]);

-- Returns the next p_count assignees for p_lane, in order, advancing the lane
-- cursor once. Callers zip the result against their lead list. Returns fewer
-- than p_count only when there are no candidates at all.
CREATE OR REPLACE FUNCTION public.assignment_pick_round_robin(
  p_lane          text,
  p_candidate_ids uuid[],
  p_count         int DEFAULT 1
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cursor uuid;
  v_len    int := array_length(p_candidate_ids, 1);
  v_idx    int;
  v_out    uuid[] := '{}';
  i        int;
BEGIN
  IF v_len IS NULL OR v_len = 0 OR p_count IS NULL OR p_count < 1 THEN
    RETURN '{}';
  END IF;

  -- Lock this lane's cursor for the transaction so concurrent callers serialize
  -- instead of both reading the same cursor and picking the same employee. The
  -- insert-then-relock loop handles a lane row racing into existence: ON CONFLICT
  -- DO NOTHING would not block on a peer's uncommitted insert, and the follow-up
  -- SELECT would then find no row to lock.
  LOOP
    SELECT cursor_employee INTO v_cursor
      FROM assignment_cursors WHERE lane = p_lane FOR UPDATE;
    EXIT WHEN FOUND;
    BEGIN
      INSERT INTO assignment_cursors (lane) VALUES (p_lane);
    EXCEPTION WHEN unique_violation THEN
      -- created concurrently; loop back and lock the winner's row
    END;
  END LOOP;

  -- array_position is 1-based, or NULL when the cursor employee has dropped out
  -- of the candidate set (deactivated / offline / territory changed) — then 0
  -- makes the first pick land on candidate 1.
  v_idx := COALESCE(array_position(p_candidate_ids, v_cursor), 0);

  FOR i IN 1..p_count LOOP
    v_idx := (v_idx % v_len) + 1;
    v_out := v_out || p_candidate_ids[v_idx];
  END LOOP;

  UPDATE assignment_cursors
     SET cursor_employee = p_candidate_ids[v_idx], updated_at = now()
   WHERE lane = p_lane;

  RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assignment_pick_round_robin(text, uuid[], int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.assignment_pick_round_robin(text, uuid[], int) TO service_role;

-- Superseded by assignment_cursors; nothing reads it. Left in place it would
-- look authoritative while never being written — which is how the previous
-- rotation quietly stopped happening.
ALTER TABLE public.assignment_settings DROP COLUMN IF EXISTS round_robin_cursor;
