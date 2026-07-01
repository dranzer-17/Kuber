-- Migration: 2026_07_01_reset_contaminated_orgs
-- Purpose: Re-queue orgs whose enrichment data contains Kuber's own identity
--          (contamination caused by the old system prompt referencing Kuber directly).
--
-- Run AFTER deploying the fixed scrape-orgs prompt (STEP 1.1).
-- Then trigger re-enrichment: POST /api/enrich/scrape-orgs with x-internal-secret header.

UPDATE organizations
SET
  company_description = NULL,
  sells_to            = NULL,
  has_scraped         = false,
  enrichment_stage    = 'queued',
  enrichment_status   = 'REQUEUED_CONTAMINATION_FIX',
  enrichment_attempts = 0,
  last_error          = NULL,
  updated_at          = NOW()
WHERE
  -- Contamination pattern A: description literally describes Kuber, not the prospect
  (
    company_description ILIKE '%masterbatch%manufacturer%'
    OR company_description ILIKE '%Kuber Polyplast%'
    OR company_description ILIKE '%specialty plastics manufacturer%'
    OR company_description ILIKE '%ISO 9001%'
  )
  -- Contamination pattern B: sells_to is the exact example string from the old prompt
  OR sells_to = 'packaging manufacturers, automotive OEMs, FMCG brands'
  OR sells_to ILIKE '%packaging manufacturers%automotive OEMs%FMCG%';

-- Verify before committing:
-- SELECT COUNT(*) FROM organizations WHERE enrichment_status = 'REQUEUED_CONTAMINATION_FIX';
