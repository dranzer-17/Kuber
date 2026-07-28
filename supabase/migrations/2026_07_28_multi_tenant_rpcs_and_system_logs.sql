-- Follow-ups to the multi-tenant split that the schema migration alone could
-- not cover: one RPC that writes to a table whose primary key changed, and two
-- log tables that legitimately hold rows belonging to no single company.

-- ---------------------------------------------------------------------------
-- 1. System-level log rows have no company
--
--    The enrichment relay writes batch markers ("BATCH_START", "no more queued
--    orgs") before it knows which companies the batch touches, and the unibox
--    sync writes audit rows for a mailbox shared by both tenants. Forcing a
--    company_id on those would mean inventing one. Nullable is the honest
--    model: a null row is system-level, and because every scoped read filters
--    `company_id = <tenant>`, null rows are invisible to tenants by
--    construction — which is what we want.
-- ---------------------------------------------------------------------------

alter table public.enrichment_logs alter column company_id drop not null;
alter table public.audit_log       alter column company_id drop not null;

-- ---------------------------------------------------------------------------
-- 2. Round-robin assignment is per-company
--
--    assignment_cursors' primary key moved from (lane) to (company_id, lane).
--    The old function selected `where lane = p_lane` — which would now match a
--    cursor row per company and lock the wrong one — and inserted a bare
--    (lane), which fails outright against the NOT NULL company_id. Both
--    tenants must round-robin over their own employees independently.
-- ---------------------------------------------------------------------------

drop function if exists public.assignment_pick_round_robin(text, uuid[], integer);

create or replace function public.assignment_pick_round_robin(
  p_company_id uuid,
  p_lane text,
  p_candidate_ids uuid[],
  p_count integer default 1
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  LOOP
    SELECT cursor_employee INTO v_cursor
      FROM assignment_cursors
     WHERE company_id = p_company_id AND lane = p_lane
       FOR UPDATE;
    EXIT WHEN FOUND;
    BEGIN
      INSERT INTO assignment_cursors (company_id, lane) VALUES (p_company_id, p_lane);
    EXCEPTION WHEN unique_violation THEN
    END;
  END LOOP;

  v_idx := COALESCE(array_position(p_candidate_ids, v_cursor), 0);

  FOR i IN 1..p_count LOOP
    v_idx := (v_idx % v_len) + 1;
    v_out := v_out || p_candidate_ids[v_idx];
  END LOOP;

  UPDATE assignment_cursors
     SET cursor_employee = p_candidate_ids[v_idx], updated_at = now()
   WHERE company_id = p_company_id AND lane = p_lane;

  RETURN v_out;
END;
$function$;
