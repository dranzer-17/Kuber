-- Remove structured Draft Content setting. Building blocks (subject patterns,
-- openings, offerings, etc.) now live only in settings.system_prompt (Email Template).
DELETE FROM settings WHERE key = 'draft_template_config';
