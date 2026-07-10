-- Track how organizations.domain was resolved, so email-inferred domains
-- (lower confidence) can be distinguished from Apollo-verified ones.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS domain_source TEXT CHECK (domain_source IN ('apollo', 'email_inferred', 'manual'));

-- Backfill: any org that already has a domain today got it from Apollo.
UPDATE organizations SET domain_source = 'apollo' WHERE domain IS NOT NULL AND domain_source IS NULL;
