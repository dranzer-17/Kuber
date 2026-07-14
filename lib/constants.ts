export const APOLLO_TITLES = [
  "purchase manager",
  "procurement manager",
  "plant manager",
  "managing director",
  "production manager",
  "procurement head",
  "purchase officer",
  "technical manager",
  "proprietor",
  "founder",
];

export const APOLLO_SENIORITIES = [
  "owner",
  "founder",
  "c_suite",
  "partner",
  "vp",
  "head",
  "director",
  "manager",
];

export const ALLOWED_KEYWORDS = ["plastics", "polymer", "moulding", "packaging"] as const;
export type AllowedKeyword = (typeof ALLOWED_KEYWORDS)[number];

export type IndustryKeyword = { label: string; starred?: boolean };
export type IndustryKeywordCategory = { id: string; label: string; emoji: string; keywords: IndustryKeyword[] };

export const INDUSTRY_KEYWORD_CATEGORIES: IndustryKeywordCategory[] = [
  {
    id: "pet-bottles",
    label: "PET Bottles & Closures",
    emoji: "🧴",
    keywords: [
      { label: "Beverage Bottles (Water/Juice/CSD)", starred: true },
      { label: "Cosmetic & Personal Care Bottles", starred: true },
      { label: "Pharma & Agrochemical Bottles" },
      { label: "Caps & Closures" },
    ],
  },
  {
    id: "blown-film",
    label: "Blown Film & Flexible Packaging",
    emoji: "📦",
    keywords: [
      { label: "Packaging Films (Pouches/Lamination)", starred: true },
      { label: "Stretch & Cling Films" },
      { label: "Agricultural Films (Mulch/Silage/Greenhouse)" },
      { label: "Milk Pouch & Food Films" },
      { label: "Courier Bags & Industrial Bags" },
    ],
  },
  {
    id: "blow-molding",
    label: "Blow Molding",
    emoji: "🪣",
    keywords: [
      { label: "Industrial Drums & IBCs" },
      { label: "Water Tanks & Storage" },
      { label: "Automotive Blow Molded Parts" },
    ],
  },
  {
    id: "injection-molding",
    label: "Injection Molding",
    emoji: "🔧",
    keywords: [
      { label: "Household Goods & Furniture", starred: true },
      { label: "Toy Manufacturers" },
      { label: "Industrial Parts (Crates/Pallets)" },
    ],
  },
  {
    id: "roto-molding",
    label: "Roto Molding",
    emoji: "🔄",
    keywords: [
      { label: "Roto Molding Tanks & Equipment" },
    ],
  },
  {
    id: "compounders",
    label: "Compounders",
    emoji: "⚗️",
    keywords: [
      { label: "PE/PP Commodity Compounders (PE100)", starred: true },
      { label: "Engineering Plastic Compounders (ABS/PC/Nylon)", starred: true },
      { label: "Recycled Plastic Compounders" },
    ],
  },
  {
    id: "recyclers",
    label: "Recyclers",
    emoji: "♻️",
    keywords: [
      { label: "PE/PP Recyclers & Reclaimers", starred: true },
      { label: "PET Recyclers & rPET Processors" },
    ],
  },
  {
    id: "specialty",
    label: "Specialty",
    emoji: "⭐",
    keywords: [
      { label: "Mono Concentrate Users (Europe/Americas)", starred: true },
      { label: "Black Masterbatch Buyers (General)" },
      { label: "Pipe Manufacturers (HDPE/PPR/PVC)", starred: true },
      { label: "Masterbatch Distributors" },
      { label: "Masterbatch Manufacturers" },
      { label: "Solar Film Manufacturers" },
      { label: "Textile & Fiber Manufacturers" },
    ],
  },
];

export type LocationCategory = { id: string; label: string; countries: string[] };

export const LOCATION_CATEGORIES: LocationCategory[] = [
  {
    id: "south-asia",
    label: "South Asia",
    countries: ["India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal", "Afghanistan", "Bhutan", "Maldives"],
  },
  {
    id: "southeast-asia",
    label: "Southeast Asia",
    countries: ["Vietnam", "Thailand", "Indonesia", "Malaysia", "Philippines", "Singapore", "Myanmar", "Cambodia", "Laos", "Brunei", "Timor-Leste"],
  },
  {
    id: "east-asia",
    label: "East Asia",
    countries: ["China", "Japan", "South Korea", "Taiwan", "Hong Kong", "Mongolia"],
  },
  {
    id: "central-asia",
    label: "Central Asia",
    countries: ["Kazakhstan", "Uzbekistan", "Turkmenistan", "Kyrgyzstan", "Tajikistan"],
  },
  {
    id: "middle-east",
    label: "Middle East",
    countries: ["UAE", "Saudi Arabia", "Turkey", "Iran", "Iraq", "Israel", "Jordan", "Kuwait", "Qatar", "Oman", "Bahrain", "Lebanon", "Syria", "Yemen", "Palestine"],
  },
  {
    id: "western-europe",
    label: "Western Europe",
    countries: ["Germany", "France", "United Kingdom", "Italy", "Spain", "Netherlands", "Belgium", "Switzerland", "Austria", "Portugal", "Sweden", "Norway", "Denmark", "Finland", "Ireland", "Greece", "Luxembourg"],
  },
  {
    id: "eastern-europe",
    label: "Eastern Europe",
    countries: ["Poland", "Czech Republic", "Romania", "Hungary", "Ukraine", "Russia", "Bulgaria", "Slovakia", "Croatia", "Serbia", "Belarus", "Slovenia", "Estonia", "Latvia", "Lithuania", "Albania", "Moldova", "Bosnia and Herzegovina", "North Macedonia", "Montenegro"],
  },
  {
    id: "north-america",
    label: "North America",
    countries: ["United States", "Canada", "Mexico"],
  },
  {
    id: "central-america-caribbean",
    label: "Central America & Caribbean",
    countries: ["Guatemala", "Honduras", "El Salvador", "Nicaragua", "Costa Rica", "Panama", "Cuba", "Dominican Republic", "Jamaica", "Haiti", "Trinidad and Tobago", "Belize"],
  },
  {
    id: "south-america",
    label: "South America",
    countries: ["Brazil", "Argentina", "Colombia", "Chile", "Peru", "Venezuela", "Ecuador", "Bolivia", "Paraguay", "Uruguay", "Guyana", "Suriname"],
  },
  {
    id: "north-africa",
    label: "North Africa",
    countries: ["Egypt", "Morocco", "Algeria", "Tunisia", "Libya", "Sudan"],
  },
  {
    id: "west-africa",
    label: "West Africa",
    countries: ["Nigeria", "Ghana", "Senegal", "Ivory Coast", "Cameroon", "Mali", "Burkina Faso", "Niger", "Guinea", "Benin", "Togo", "Sierra Leone", "Liberia", "Gambia"],
  },
  {
    id: "east-africa",
    label: "East Africa",
    countries: ["Kenya", "Ethiopia", "Tanzania", "Uganda", "Rwanda", "Somalia", "Mozambique", "Madagascar", "Zambia", "Zimbabwe", "Malawi", "Botswana", "Namibia"],
  },
  {
    id: "southern-africa",
    label: "Southern Africa",
    countries: ["South Africa", "Angola", "Lesotho", "Eswatini"],
  },
  {
    id: "oceania",
    label: "Oceania",
    countries: ["Australia", "New Zealand", "Papua New Guinea", "Fiji", "Solomon Islands", "Vanuatu", "Samoa", "Tonga"],
  },
];

export const EMPLOYEE_RANGES = ["10,200", "200,1000"];

export const CONTACT_EMAIL_STATUSES = ["verified", "likely to engage"];

/** Maps UI dropdown label → Apollo person_locations[] value */
export const LOCATION_MAP: Record<string, string> = {
  // South Asia
  India: "India", Pakistan: "Pakistan", Bangladesh: "Bangladesh", "Sri Lanka": "Sri Lanka",
  Nepal: "Nepal", Afghanistan: "Afghanistan", Bhutan: "Bhutan", Maldives: "Maldives",
  // Southeast Asia
  Vietnam: "Vietnam", Thailand: "Thailand", Indonesia: "Indonesia", Malaysia: "Malaysia",
  Philippines: "Philippines", Singapore: "Singapore", Myanmar: "Myanmar", Cambodia: "Cambodia",
  Laos: "Laos", Brunei: "Brunei", "Timor-Leste": "Timor-Leste",
  // East Asia
  China: "China", Japan: "Japan", "South Korea": "South Korea", Taiwan: "Taiwan",
  "Hong Kong": "Hong Kong", Mongolia: "Mongolia",
  // Central Asia
  Kazakhstan: "Kazakhstan", Uzbekistan: "Uzbekistan", Turkmenistan: "Turkmenistan",
  Kyrgyzstan: "Kyrgyzstan", Tajikistan: "Tajikistan",
  // Middle East
  UAE: "United Arab Emirates", "Saudi Arabia": "Saudi Arabia", Turkey: "Turkey",
  Iran: "Iran", Iraq: "Iraq", Israel: "Israel", Jordan: "Jordan", Kuwait: "Kuwait",
  Qatar: "Qatar", Oman: "Oman", Bahrain: "Bahrain", Lebanon: "Lebanon",
  Syria: "Syria", Yemen: "Yemen", Palestine: "Palestine",
  // Western Europe
  Germany: "Germany", France: "France", "United Kingdom": "United Kingdom", Italy: "Italy",
  Spain: "Spain", Netherlands: "Netherlands", Belgium: "Belgium", Switzerland: "Switzerland",
  Austria: "Austria", Portugal: "Portugal", Sweden: "Sweden", Norway: "Norway",
  Denmark: "Denmark", Finland: "Finland", Ireland: "Ireland", Greece: "Greece",
  Luxembourg: "Luxembourg",
  // Eastern Europe
  Poland: "Poland", "Czech Republic": "Czech Republic", Romania: "Romania", Hungary: "Hungary",
  Ukraine: "Ukraine", Russia: "Russia", Bulgaria: "Bulgaria", Slovakia: "Slovakia",
  Croatia: "Croatia", Serbia: "Serbia", Belarus: "Belarus", Slovenia: "Slovenia",
  Estonia: "Estonia", Latvia: "Latvia", Lithuania: "Lithuania", Albania: "Albania",
  Moldova: "Moldova", "Bosnia and Herzegovina": "Bosnia and Herzegovina",
  "North Macedonia": "North Macedonia", Montenegro: "Montenegro",
  // North America
  "United States": "United States", Canada: "Canada", Mexico: "Mexico",
  // Central America & Caribbean
  Guatemala: "Guatemala", Honduras: "Honduras", "El Salvador": "El Salvador",
  Nicaragua: "Nicaragua", "Costa Rica": "Costa Rica", Panama: "Panama", Cuba: "Cuba",
  "Dominican Republic": "Dominican Republic", Jamaica: "Jamaica", Haiti: "Haiti",
  "Trinidad and Tobago": "Trinidad and Tobago", Belize: "Belize",
  // South America
  Brazil: "Brazil", Argentina: "Argentina", Colombia: "Colombia", Chile: "Chile",
  Peru: "Peru", Venezuela: "Venezuela", Ecuador: "Ecuador", Bolivia: "Bolivia",
  Paraguay: "Paraguay", Uruguay: "Uruguay", Guyana: "Guyana", Suriname: "Suriname",
  // North Africa
  Egypt: "Egypt", Morocco: "Morocco", Algeria: "Algeria", Tunisia: "Tunisia",
  Libya: "Libya", Sudan: "Sudan",
  // West Africa
  Nigeria: "Nigeria", Ghana: "Ghana", Senegal: "Senegal", "Ivory Coast": "Ivory Coast",
  Cameroon: "Cameroon", Mali: "Mali", "Burkina Faso": "Burkina Faso", Niger: "Niger",
  Guinea: "Guinea", Benin: "Benin", Togo: "Togo", "Sierra Leone": "Sierra Leone",
  Liberia: "Liberia", Gambia: "Gambia",
  // East Africa
  Kenya: "Kenya", Ethiopia: "Ethiopia", Tanzania: "Tanzania", Uganda: "Uganda",
  Rwanda: "Rwanda", Somalia: "Somalia", Mozambique: "Mozambique", Madagascar: "Madagascar",
  Zambia: "Zambia", Zimbabwe: "Zimbabwe", Malawi: "Malawi", Botswana: "Botswana",
  Namibia: "Namibia",
  // Southern Africa
  "South Africa": "South Africa", Angola: "Angola", Lesotho: "Lesotho", Eswatini: "Eswatini",
  // Oceania
  Australia: "Australia", "New Zealand": "New Zealand", "Papua New Guinea": "Papua New Guinea",
  Fiji: "Fiji", "Solomon Islands": "Solomon Islands", Vanuatu: "Vanuatu",
  Samoa: "Samoa", Tonga: "Tonga",
};

/** Default timezone per country when lead.time_zone is absent */
export const COUNTRY_TIMEZONE: Record<string, string> = {
  India: "Asia/Kolkata",
  Bangladesh: "Asia/Dhaka",
  "Sri Lanka": "Asia/Colombo",
  Pakistan: "Asia/Karachi",
  Poland: "Europe/Warsaw",
  "Czech Republic": "Europe/Prague",
  Romania: "Europe/Bucharest",
  "United Arab Emirates": "Asia/Dubai",
  "Saudi Arabia": "Asia/Riyadh",
  Turkey: "Europe/Istanbul",
  Vietnam: "Asia/Ho_Chi_Minh",
  Thailand: "Asia/Bangkok",
  Indonesia: "Asia/Jakarta",
  Malaysia: "Asia/Kuala_Lumpur",
  Egypt: "Africa/Cairo",
  Nigeria: "Africa/Lagos",
  Kenya: "Africa/Nairobi",
  Brazil: "America/Sao_Paulo",
  Mexico: "America/Mexico_City",
};

export const COUNTRY_TO_TIMEZONE: Record<string, string> = {
  ...COUNTRY_TIMEZONE,
  UAE: "Asia/Dubai",
  "United States": "America/New_York",
  USA: "America/New_York",
  "United Kingdom": "Europe/London",
  Germany: "Europe/Berlin",
  Singapore: "Asia/Singapore",
};


export type CampaignStepInput = {
  step_order: number;
  delay: number;
  delay_unit: "minutes" | "hours" | "days";
  subject: string;
  body: string;
};

export type FollowupStepInput = {
  delay: number;
  delay_unit: "minutes" | "hours" | "days";
};

/**
 * Builds the campaign_steps rows for a new campaign given an array of follow-up
 * waits. Each entry in `followupSteps` is the wait AFTER the previous email
 * before that follow-up sends.
 *
 * Instantly's `delay`/`delay_unit` on a step is NOT "wait before this email" —
 * it's "wait before the NEXT email" (see developer.instantly.ai). So the wait
 * values are stored shifted back by one step: step N's delay holds the wait
 * before step N+1. The final step's delay is unused (there's no step after it)
 * and is left at 0/"days".
 */
export function buildDefaultCampaignSteps(followupSteps: FollowupStepInput[]): CampaignStepInput[] {
  const steps: CampaignStepInput[] = [
    {
      step_order: 1,
      delay: followupSteps[0]?.delay ?? 0,
      delay_unit: followupSteps[0]?.delay_unit ?? "days",
      subject: "{{customSubject}}",
      body: "{{customBody}}",
    },
  ];

  followupSteps.forEach((_, idx) => {
    const next = followupSteps[idx + 1];
    steps.push({
      step_order: idx + 2,
      delay: next?.delay ?? 0,
      delay_unit: next?.delay_unit ?? "days",
      subject: "", // empty = Instantly threads it as a reply in the same conversation
      body: `{{customBody${idx + 2}}}`, // per-lead variable; seeded with generic fallback at lead-push time
    });
  });

  return steps;
}

/** Read follow-up wait times from stored steps (Instantly: delay on step N = wait before step N+1). */
export function extractFollowupWaitsFromSteps(
  steps: Array<{ step_order: number; delay: number; delay_unit?: string | null }>,
): FollowupStepInput[] {
  const sorted = [...steps].sort((a, b) => a.step_order - b.step_order);
  if (sorted.length <= 1) return [];
  return sorted.slice(0, -1).map((s) => ({
    delay: s.delay ?? 0,
    delay_unit: (s.delay_unit ?? "days") as FollowupStepInput["delay_unit"],
  }));
}

/** Apply follow-up waits onto existing steps, preserving subjects/bodies. Adds or removes steps as needed. */
export function rebuildStepsWithFollowupWaits<T extends CampaignStepInput>(
  existingSteps: T[],
  followupWaits: FollowupStepInput[],
): T[] {
  const sorted = [...existingSteps].sort((a, b) => a.step_order - b.step_order);
  const defaults = buildDefaultCampaignSteps(
    followupWaits.length > 0 ? followupWaits : [{ delay: 30, delay_unit: "days" }],
  );
  return defaults.map((def) => {
    const existing = sorted.find((s) => s.step_order === def.step_order);
    if (existing) {
      return { ...existing, delay: def.delay, delay_unit: def.delay_unit };
    }
    return def as T;
  });
}

export const BATCH_COLORS = [
  { name: "violet", bg: "bg-violet-400",  ring: "ring-violet-400",  text: "text-violet-400",  pill: "bg-violet-500/15 border-violet-500/30 text-violet-400"  },
  { name: "blue",   bg: "bg-blue-400",    ring: "ring-blue-400",    text: "text-blue-400",    pill: "bg-blue-500/15 border-blue-500/30 text-blue-400"         },
  { name: "cyan",   bg: "bg-cyan-400",    ring: "ring-cyan-400",    text: "text-cyan-400",    pill: "bg-cyan-500/15 border-cyan-500/30 text-cyan-400"         },
  { name: "green",  bg: "bg-green-400",   ring: "ring-green-400",   text: "text-green-400",   pill: "bg-green-500/15 border-green-500/30 text-green-400"      },
  { name: "amber",  bg: "bg-amber-400",   ring: "ring-amber-400",   text: "text-amber-400",   pill: "bg-amber-500/15 border-amber-500/30 text-amber-400"      },
  { name: "orange", bg: "bg-orange-400",  ring: "ring-orange-400",  text: "text-orange-400",  pill: "bg-orange-500/15 border-orange-500/30 text-orange-400"   },
  { name: "pink",   bg: "bg-pink-400",    ring: "ring-pink-400",    text: "text-pink-400",    pill: "bg-pink-500/15 border-pink-500/30 text-pink-400"         },
  { name: "teal",   bg: "bg-teal-400",    ring: "ring-teal-400",    text: "text-teal-400",    pill: "bg-teal-500/15 border-teal-500/30 text-teal-400"         },
] as const;

export type BatchColorName = typeof BATCH_COLORS[number]["name"];

export function getBatchColor(name: string) {
  return BATCH_COLORS.find((c) => c.name === name) ?? BATCH_COLORS[0];
}

// ─── Reply classification maps ────────────────────────────────────────────────

// Map our temperature bucket → Instantly interest code (for syncing back via API)
export const TEMPERATURE_TO_INTEREST: Record<string, number | null> = {
  hot: 1,          // Interested
  warm: 1,         // also Interested in Instantly (no separate "warm" code)
  cold: -1,        // Not Interested
  neutral: null,   // leave as Lead
  ooo: 0,          // Out of Office
  unsubscribed: null,
};

// Map Instantly interest code → our temperature (for webhook lead_* events)
export const INTEREST_TO_TEMPERATURE: Record<number, string> = {
  1: "hot", 2: "hot", 3: "hot", 4: "hot",
  0: "ooo",
  [-1]: "cold", [-2]: "cold", [-3]: "cold",
};


// ─── Territory routing (planning.md Phase 4 / Q8) ─────────────────────────────
// Countries treated as the "europe" region for lead assignment. Lowercased
// full names as Apollo/Excel return them; everything else non-India = "foreign".
export const EUROPE_COUNTRIES: ReadonlySet<string> = new Set([
  "albania", "andorra", "austria", "belarus", "belgium", "bosnia and herzegovina",
  "bulgaria", "croatia", "cyprus", "czech republic", "czechia", "denmark",
  "estonia", "finland", "france", "germany", "greece", "hungary", "iceland",
  "ireland", "italy", "kosovo", "latvia", "liechtenstein", "lithuania",
  "luxembourg", "malta", "moldova", "monaco", "montenegro", "netherlands",
  "north macedonia", "norway", "poland", "portugal", "romania", "san marino",
  "serbia", "slovakia", "slovenia", "spain", "sweden", "switzerland",
  "ukraine", "united kingdom", "uk", "great britain", "england", "scotland",
  "wales", "vatican city",
]);
