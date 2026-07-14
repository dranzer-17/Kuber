-- DB hygiene (Phase 0.6 of planning.md).
-- 1. The unibox_emails.direction CHECK never matched what the app writes
--    (ueTypeToDirection emits sent_campaign / received / sent_manual / scheduled)
--    — replace it with the real vocabulary and validate.
-- 2. Validate the remaining NOT VALID status CHECKs (data verified clean).
-- 3. Drop the stray auth-based RLS policy on enrichment_logs (unused — every
--    access path uses the service role; the policy only cost per-row auth calls).
-- 4. updated_at maintained by trigger on hot tables (was app-managed only).

alter table public.unibox_emails drop constraint if exists unibox_emails_direction_chk;
alter table public.unibox_emails add constraint unibox_emails_direction_chk
  check (direction in ('sent_campaign','received','sent_manual','scheduled')) not valid;
alter table public.unibox_emails validate constraint unibox_emails_direction_chk;

alter table public.campaigns    validate constraint campaigns_status_chk;
alter table public.campaigns    validate constraint campaigns_send_mode_chk;
alter table public.email_drafts validate constraint email_drafts_status_chk;

drop policy if exists "users read own org logs" on public.enrichment_logs;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

drop trigger if exists campaign_leads_set_updated_at on public.campaign_leads;
create trigger campaign_leads_set_updated_at
  before update on public.campaign_leads
  for each row execute function public.set_updated_at();

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();
