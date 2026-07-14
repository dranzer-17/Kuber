-- 'sending' = an in-flight atomic claim on the reply (planning.md Phase 6.3).
-- The send route flips draft/approved → sending in one guarded UPDATE, so two
-- rapid clicks can never both pass the status check and double-send.

alter table public.reply_drafts drop constraint if exists reply_drafts_status_check;
alter table public.reply_drafts add constraint reply_drafts_status_check
  check (status in ('generating','draft','approved','sending','sent','failed','rejected'));
