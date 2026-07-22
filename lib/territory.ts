import { LOCATION_CATEGORIES, LOCATION_MAP } from "@/lib/constants";

/**
 * Country handling for territory-based lead routing.
 *
 * An employee's territory is a list of countries (the Apollo location picker's
 * output). Deciding whether a lead belongs to someone is therefore a string
 * comparison — and string comparison on country names is where this quietly
 * breaks, because the names in `leads.country` come from Apollo and are not
 * tidy. Live data currently contains `US` and `United States`, `Czechia` and
 * `Czech Republic`, `Tuerkiye` and `Turkey`, and
 * `Republic of the Union of Myanmar`. The picker itself labels the UAE as
 * `UAE` while every lead says `United Arab Emirates`.
 *
 * So both sides go through canonicalCountry() before they ever meet. Skipping
 * that doesn't error — it just drops leads into the manager's pool, which looks
 * from the outside like "territory routing doesn't work".
 */

/** Canonical name → itself, plus every picker label that differs from it. */
const CANONICAL_BY_LOWER: Map<string, string> = (() => {
  const map = new Map<string, string>();
  // LOCATION_MAP's VALUES are the canonical (Apollo) names; its keys are the
  // picker's display labels, which sometimes differ (UAE → United Arab Emirates).
  for (const [label, canonical] of Object.entries(LOCATION_MAP)) {
    map.set(canonical.toLowerCase(), canonical);
    map.set(label.toLowerCase(), canonical);
  }
  return map;
})();

/**
 * Spellings seen in real lead data that no amount of case-folding resolves.
 * Add to this rather than "fixing" the data — Apollo will send them again.
 */
const ALIASES: Record<string, string> = {
  "us": "United States",
  "usa": "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  "united states of america": "United States",
  "uk": "United Kingdom",
  "u.k.": "United Kingdom",
  "great britain": "United Kingdom",
  "england": "United Kingdom",
  "scotland": "United Kingdom",
  "wales": "United Kingdom",
  "northern ireland": "United Kingdom",
  "czechia": "Czech Republic",
  "tuerkiye": "Turkey",
  "türkiye": "Turkey",
  "turkiye": "Turkey",
  "republic of the union of myanmar": "Myanmar",
  "burma": "Myanmar",
  "united arab emirates": "United Arab Emirates",
  "u.a.e.": "United Arab Emirates",
  "uae": "United Arab Emirates",
  "korea, republic of": "South Korea",
  "republic of korea": "South Korea",
  "russian federation": "Russia",
  "viet nam": "Vietnam",
  "ivory coast": "Ivory Coast",
  "côte d'ivoire": "Ivory Coast",
  "cote d'ivoire": "Ivory Coast",
  "cabo verde": "Cape Verde",
  "swaziland": "Eswatini",
  "macedonia": "North Macedonia",
  "holland": "Netherlands",
  "the netherlands": "Netherlands",
};

/**
 * Resolve any spelling of a country to the one name used everywhere else.
 * Returns null for empty input or a country we do not know — such leads are
 * left in the manager's pool, exactly as a lead with no country already is.
 */
export function canonicalCountry(raw: string | null | undefined): string | null {
  const key = raw?.trim().toLowerCase();
  if (!key) return null;
  const alias = ALIASES[key];
  if (alias) return alias;
  return CANONICAL_BY_LOWER.get(key) ?? null;
}

/** Canonicalise a list (picker labels or stored values), dropping unknowns and duplicates. */
export function canonicalCountryList(raw: readonly string[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const item of raw ?? []) {
    const c = canonicalCountry(item);
    if (c) out.add(c);
  }
  return [...out].sort();
}

/** Every canonical country the picker knows about. */
export function allCanonicalCountries(): string[] {
  return [...new Set(Object.values(LOCATION_MAP))].sort();
}

/** Canonical countries of one region, by region id. */
export function countriesForRegion(regionId: string): string[] {
  const region = LOCATION_CATEGORIES.find((r) => r.id === regionId);
  return canonicalCountryList(region?.countries ?? []);
}

/** The region a country belongs to, or null when it is in none. */
export function regionOfCountry(country: string): { id: string; label: string } | null {
  const canonical = canonicalCountry(country);
  if (!canonical) return null;
  for (const region of LOCATION_CATEGORIES) {
    if (canonicalCountryList(region.countries).includes(canonical)) {
      return { id: region.id, label: region.label };
    }
  }
  return null;
}

/**
 * Human summary of a territory for a narrow table cell: a fully-ticked region
 * by name, a short list of countries verbatim, otherwise counts.
 */
export function summarizeTerritory(countries: readonly string[] | null | undefined): string {
  const owned = new Set(canonicalCountryList(countries));
  if (owned.size === 0) return "No territory";

  const fullRegions: string[] = [];
  let coveredByFullRegions = 0;
  for (const region of LOCATION_CATEGORIES) {
    const list = canonicalCountryList(region.countries);
    if (list.length > 0 && list.every((c) => owned.has(c))) {
      fullRegions.push(region.label);
      coveredByFullRegions += list.length;
    }
  }

  // Everything ticked — say so plainly instead of "16 regions · 150 countries".
  if (owned.size >= allCanonicalCountries().length) return "Worldwide";

  const strays = owned.size - coveredByFullRegions;
  if (fullRegions.length === 1 && strays === 0) return fullRegions[0];
  if (fullRegions.length === 0 && owned.size <= 3) return [...owned].join(", ");
  if (fullRegions.length === 0) return `${owned.size} countries`;
  return `${fullRegions.length} region${fullRegions.length !== 1 ? "s" : ""} · ${owned.size} countries`;
}
