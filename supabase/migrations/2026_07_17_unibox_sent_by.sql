-- Sender attribution on outbound Unibox messages (review §4.2). Only set for
-- replies sent through our own reply endpoints (unibox + reply-drafts); rows
-- synced/ingested from Instantly directly (cold-email fanout, resync) leave
-- this null since we don't know who triggered them. No FK to auth.users,
-- matching the existing created_by/updated_by convention on other tables.
alter table public.unibox_emails add column if not exists sent_by uuid;
