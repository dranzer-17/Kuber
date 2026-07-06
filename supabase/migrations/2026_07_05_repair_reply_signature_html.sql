-- Repair reply_drafts signatures to tight single-<p> with <br> line breaks.

-- Collapsed single-line signature → tight block
UPDATE reply_drafts
SET body = regexp_replace(
  body,
  '<p>\s*([^<]*sales@kuberpolyplast\.com[^<]*)\s*</p>\s*$',
  '<p>Kuber Polyplast<br>sales@kuberpolyplast.com<br>+91 9820537790</p>',
  'i'
),
updated_at = now()
WHERE body ~ '<p>[^<]*sales@kuberpolyplast\.com[^<]*</p>\s*$'
  AND body !~ '<br>'
  AND status IN ('draft', 'approved', 'generating');

-- Per-line <p> signature tail → tight block
UPDATE reply_drafts
SET body = regexp_replace(
  body,
  '(</p>)<p>Kuber Polyplast</p><p>sales@kuberpolyplast\.com</p><p>\+91 9820537790</p>\s*$',
  '\1<p>Kuber Polyplast<br>sales@kuberpolyplast.com<br>+91 9820537790</p>',
  'i'
),
updated_at = now()
WHERE body ~ '<p>Kuber Polyplast</p><p>sales@kuberpolyplast\.com</p>'
  AND status IN ('draft', 'approved', 'generating');

-- Bare <br> signature tail → tight block
UPDATE reply_drafts
SET body = regexp_replace(
  body,
  '</p><br><br>([^<]+)<br>([^<]+)<br>([^<]+)\s*$',
  '</p><p>\1<br>\2<br>\3</p>',
  'i'
),
updated_at = now()
WHERE body ~ '</p><br><br>[^<]+<br>[^<]+<br>[^<]+\s*$'
  AND status IN ('draft', 'approved', 'generating');
