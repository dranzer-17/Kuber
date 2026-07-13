-- Generic (name-swap) email template for un-enriched leads.
-- Leads whose company has no usable profile (no website / unscrapeable / enrichment
-- failed → lead status 'input_required') can now join a campaign and are drafted from
-- this ready-made template instead of an AI-personalised email. Only the recipient's
-- name/company is filled in. Supported placeholders: {{first_name}}, {{name}}, {{company}}.
--
-- These rows are OPTIONAL: lib/services/settings.ts::getGenericTemplate falls back to
-- baked-in defaults when the keys are absent. Seeding them lets an admin customise the
-- copy without a code change. ON CONFLICT DO NOTHING preserves any existing edits.

INSERT INTO settings (key, value) VALUES
  ('generic_email_subject', 'Reliable masterbatch & polymer compounds for your production'),
  ('generic_email_body', E'I hope this message finds you well. I am reaching out from Kuber Polyplast, a manufacturer of high-quality masterbatch and polymer compounds.\n\nWe supply colour, white, black and additive masterbatches used across packaging, moulding and extrusion. Manufacturers work with us for consistent quality batch after batch and dependable, on-time supply.\n\nIf improving material quality or cost is on your radar, I would be glad to understand your requirements and share options that fit. Would you be open to a short conversation?')
ON CONFLICT (key) DO NOTHING;
