-- Migration: 2026_07_01_missing_indexes
-- Adds missing FK and performance indexes across key tables.

-- reply_events: campaign_lead_id lookup (used heavily in webhook handler)
CREATE INDEX IF NOT EXISTS reply_events_campaign_lead_id_idx
  ON reply_events (campaign_lead_id);

-- reply_events: campaign_id + event_type (used by GET /campaigns/{id}/replies)
CREATE INDEX IF NOT EXISTS reply_events_campaign_event_idx
  ON reply_events (campaign_id, event_type);

-- reply_events: event_uid uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS reply_events_event_uid_unique_idx
  ON reply_events (event_uid);

-- reply_drafts: reply_event_id (used in join in GET /campaigns/{id}/replies)
CREATE INDEX IF NOT EXISTS reply_drafts_reply_event_id_idx
  ON reply_drafts (reply_event_id);

-- reply_drafts: campaign_id + status (used for pending review queries)
CREATE INDEX IF NOT EXISTS reply_drafts_campaign_status_idx
  ON reply_drafts (campaign_id, status);

-- email_drafts: step_number (new column usage for follow-up drafts)
CREATE INDEX IF NOT EXISTS email_drafts_step_number_idx
  ON email_drafts (campaign_id, step_number);

-- campaign_leads: instantly_campaign_id lookup (webhook handler resolves sub→master)
CREATE INDEX IF NOT EXISTS campaign_leads_instantly_campaign_id_idx
  ON campaign_leads (instantly_campaign_id);

-- organizations: enrichment_stage (used in scrape-orgs batch query)
CREATE INDEX IF NOT EXISTS organizations_enrichment_stage_idx
  ON organizations (enrichment_stage);

-- leads: organization_id (FK used in enrichment sync)
CREATE INDEX IF NOT EXISTS leads_organization_id_idx
  ON leads (organization_id)
  WHERE is_deleted = false;
