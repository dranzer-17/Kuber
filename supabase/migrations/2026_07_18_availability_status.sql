-- Online/Offline availability (spec §2B). This is SEPARATE from is_active:
--   • is_active = false  → account deactivated: forced logout, cannot log in,
--     excluded from ALL assignment (manual/round-robin/territory).
--   • availability_status = 'offline' → temporarily unavailable (leave/vacation):
--     the user still exists and can still log in, but is excluded from
--     AUTOMATIC assignment (round-robin/territory) and only receives manual
--     assignment with an explicit warning.
--
-- Super Admins are never assignment targets, so their availability is
-- irrelevant, but the column applies uniformly to keep the model simple.
alter table public.profiles
  add column if not exists availability_status text not null default 'online'
  check (availability_status in ('online', 'offline'));
