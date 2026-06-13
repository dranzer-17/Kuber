-- Kuber Polyplast — Sales Automation Platform
-- Schema v5.1 — paste this entire file into the Supabase SQL editor and run it.

-- ─────────────────────────────────────────────
-- TABLE 1 — ORGANIZATIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apollo_org_id     TEXT UNIQUE,
  domain            TEXT,
  website           TEXT,
  name              TEXT NOT NULL,
  industry          TEXT,
  keywords          TEXT[],
  employees         INTEGER,
  city              TEXT,
  country           TEXT,
  description       TEXT,
  primary_products  TEXT[],
  firecrawl_md_path TEXT,
  has_scraped       BOOLEAN NOT NULL DEFAULT false,
  unsubscribed      BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ
);

-- Partial unique index: domain must be unique when not null
CREATE UNIQUE INDEX IF NOT EXISTS organizations_domain_unique
  ON organizations(domain) WHERE domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS organizations_has_scraped_idx
  ON organizations(has_scraped);

-- ─────────────────────────────────────────────
-- TABLE 2 — LEADS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID REFERENCES organizations(id),
  apollo_id             TEXT UNIQUE NOT NULL,
  first_name            TEXT,
  title                 TEXT,
  has_email             BOOLEAN,
  last_name             TEXT,
  email                 TEXT,
  email_status          TEXT,
  headline              TEXT,
  linkedin_url          TEXT,
  city                  TEXT,
  state                 TEXT,
  country               TEXT,
  time_zone             TEXT,
  email_domain_catchall BOOLEAN,
  seniority             TEXT,
  departments           TEXT[],
  is_likely_to_engage   BOOLEAN,
  lead_source           VARCHAR NOT NULL,
  created_by            UUID NOT NULL,
  updated_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS leads_organization_id_idx ON leads(organization_id);
CREATE INDEX IF NOT EXISTS leads_email_idx           ON leads(email);
CREATE INDEX IF NOT EXISTS leads_country_idx         ON leads(country);

-- ─────────────────────────────────────────────
-- TABLE 3 — CAMPAIGNS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  instantly_campaign_id TEXT,
  human_in_loop         BOOLEAN NOT NULL DEFAULT true,
  status                VARCHAR NOT NULL DEFAULT 'draft',
  send_mode             VARCHAR NOT NULL DEFAULT 'now',
  schedule_start_at     TIMESTAMPTZ,
  window_from           TEXT,
  window_to             TEXT,
  send_days             JSONB,
  schedule_timezone     TEXT,
  daily_limit           INTEGER NOT NULL DEFAULT 30,
  follow_up_pattern     JSONB,
  total_leads           INTEGER NOT NULL DEFAULT 0,
  sent_count            INTEGER NOT NULL DEFAULT 0,
  opened_count          INTEGER NOT NULL DEFAULT 0,
  replied_count         INTEGER NOT NULL DEFAULT 0,
  hot_count             INTEGER NOT NULL DEFAULT 0,
  created_by            UUID NOT NULL,
  updated_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

-- ─────────────────────────────────────────────
-- TABLE 5 — EMAIL_DRAFTS (created before campaign_leads which refs it)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_drafts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID NOT NULL REFERENCES leads(id),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id),
  subject          TEXT,
  body             TEXT,
  status           VARCHAR NOT NULL DEFAULT 'generating',
  reviewed_by      UUID,
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_drafts_lead_id_idx     ON email_drafts(lead_id);
CREATE INDEX IF NOT EXISTS email_drafts_campaign_id_idx ON email_drafts(campaign_id);
CREATE INDEX IF NOT EXISTS email_drafts_status_idx      ON email_drafts(status);

-- ─────────────────────────────────────────────
-- TABLE 4 — CAMPAIGN_LEADS (junction)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID NOT NULL REFERENCES campaigns(id),
  lead_id           UUID NOT NULL REFERENCES leads(id),
  crm_status        VARCHAR NOT NULL DEFAULT 'new',
  instantly_lead_id TEXT,
  draft_id          UUID REFERENCES email_drafts(id),
  interest_status   INTEGER,
  last_reply_at     TIMESTAMPTZ,
  last_reply_body   TEXT,
  created_by        UUID NOT NULL,
  updated_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ,
  CONSTRAINT uq_campaign_lead UNIQUE (campaign_id, lead_id)
);

CREATE INDEX IF NOT EXISTS campaign_leads_campaign_id_idx ON campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_leads_lead_id_idx     ON campaign_leads(lead_id);
CREATE INDEX IF NOT EXISTS campaign_leads_crm_status_idx  ON campaign_leads(crm_status);

-- ─────────────────────────────────────────────
-- TABLE 6 — REPLY_EVENTS (append-only webhook log)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reply_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_uid        TEXT NOT NULL UNIQUE,
  campaign_lead_id UUID NOT NULL REFERENCES campaign_leads(id),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id),
  event_type       TEXT NOT NULL,
  reply_body       TEXT,
  intent_classified TEXT,
  instantly_lead_id TEXT,
  received_at      TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reply_events_campaign_lead_id_idx ON reply_events(campaign_lead_id);
CREATE INDEX IF NOT EXISTS reply_events_campaign_id_idx      ON reply_events(campaign_id);
CREATE INDEX IF NOT EXISTS reply_events_event_type_idx       ON reply_events(event_type);
