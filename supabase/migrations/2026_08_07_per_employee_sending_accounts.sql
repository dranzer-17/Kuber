-- Per-employee Instantly sending mailbox.
--
-- Until now every campaign went out from ONE company-wide mailbox
-- (settings.instantly_sending_accounts). That is how 60+ of Ankit's leads were
-- mailed from pushkar.garg@ — there was no way to say "this person sends as
-- themselves".
--
-- Instantly assigns senders at the CAMPAIGN level (email_list), never per lead,
-- so "each employee sends from their own mailbox" has to become a sub-campaign
-- split: what was one row per (campaign, country) becomes one per
-- (campaign, country, sender). An existing sub-campaign is never re-pointed at
-- a different mailbox — leads already inside it keep sending, and replying,
-- from the mailbox that first contacted them.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sending_email text;

COMMENT ON COLUMN profiles.sending_email IS
  'Instantly mailbox this user''s leads are mailed from. NULL = fall back to the company default (settings.instantly_sending_accounts). Deliberately NOT unique: one mailbox may be shared by several employees.';

ALTER TABLE instantly_campaigns ADD COLUMN IF NOT EXISTS sender_email text;

-- Backfill from the list each sub-campaign was actually created with, so the
-- new unique key is stable for rows that predate this column. Every existing
-- row has a non-empty email_list (NOT NULL, and the fanout refuses to create a
-- campaign without one).
UPDATE instantly_campaigns SET sender_email = email_list[1] WHERE sender_email IS NULL;

-- NOT NULL matters for the constraint below: in Postgres, NULLs are never equal
-- to each other, so a nullable column would let duplicate (campaign, country)
-- rows back in through the gap.
ALTER TABLE instantly_campaigns ALTER COLUMN sender_email SET NOT NULL;

ALTER TABLE instantly_campaigns DROP CONSTRAINT IF EXISTS uq_instantly_campaign_country;
ALTER TABLE instantly_campaigns
  ADD CONSTRAINT uq_instantly_campaign_country_sender
  UNIQUE (campaign_id, country_code, sender_email);
