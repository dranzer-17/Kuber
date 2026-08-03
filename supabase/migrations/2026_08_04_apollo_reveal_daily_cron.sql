-- Move the paid Apollo email-reveal resume off the 15-minute watchdog onto its
-- own once-a-day schedule.
--
-- Why: triggerEnrichWatchdog is the only background job in the app that can
-- spend money. Riding along inside `enrichment-watchdog` (*/15) gave any defect
-- in the reveal path 96 chances a day to become a charge. That is not a
-- hypothetical: between 15 and 26 July 2026 one lead that could neither be
-- revealed nor archived was re-asked on every pass and cost ~420 credits, at a
-- flat 96/day once this scheduler started firing reliably. Apollo's own billing
-- export confirmed it to the credit.
--
-- Same defect on a daily schedule costs 1 credit a day and shows up in the
-- usage log long before it matters. The delay is free: a healthy import chains
-- itself through in seconds and never reaches this job. It only exists for the
-- case where that chain died (redeploy, crash, function timeout), and a lead
-- that arrives a day later is still a lead.
--
-- The 15-minute `enrichment-watchdog` job keeps running untouched — it now
-- nudges only the Firecrawl scrape pipeline and the LLM draft regeneration,
-- neither of which can spend an Apollo credit.

select cron.schedule(
  'resume-apollo-reveal',
  '10 4 * * *',   -- 04:10 UTC daily, off-peak and clear of the 03:20 history purge
  $$select public.ping_internal_route('/api/internal/resume-apollo-reveal', 60000)$$
);
