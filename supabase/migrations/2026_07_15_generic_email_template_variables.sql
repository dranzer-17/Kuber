-- Update the generic (name-swap) template defaults so subject/body include
-- {{first_name}} / {{company}} placeholders. Matches GENERIC_TEMPLATE_DEFAULTS
-- in lib/services/settings.ts. Upserts so live rows pick up the new copy;
-- managers can re-edit under Settings → AI & Outreach → Default draft.

INSERT INTO settings (key, value) VALUES
  (
    'generic_email_subject',
    'Reliable masterbatch & polymer compounds for {{company}}'
  ),
  (
    'generic_email_body',
    E'I hope this message finds you well. I am reaching out from Kuber Polyplast regarding {{company}}.\n\nWe manufacture colour, white, black and additive masterbatches used across packaging, moulding and extrusion. Manufacturers work with us for consistent quality batch after batch and dependable, on-time supply.\n\nIf improving material quality or cost is on your radar, I would be glad to understand {{company}}''s requirements and share options that fit. Would you be open to a short conversation?'
  )
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
