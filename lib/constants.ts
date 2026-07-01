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

export const KUBER_CONTEXT = `Kuber Polyplast is an ISO 9001:2015 certified Indian masterbatch and specialty-compound manufacturer. 30 years of experience, ~18,000 MT/year production capacity, exporting to 50+ countries. Product range: Black Masterbatch (carbon black up to 55%, UV/weather resistant, <50 PPM grit, PE/PP/PET/Nylon/PMMA/HIPS), White Masterbatch (TiO₂ up to 85%, food-contact compliant, milk pouch and packaging grade), Colour Masterbatch (RoHS & REACH compliant, pearlescent/marble/fluorescent effects, heavy-metal-free, 0.2% micro-granule dosage option), Additive Masterbatch (UV stabiliser, anti-block, slip, anti-static, flame retardant, anti-fog, oxo-biodegradable, silicon for HDPE pipes), Filler Masterbatch. Compatible across PE, PP, PET, PS, ABS, EVA, PBT, PC, Nylon, PMMA, GPPS, HIPS. Processing: film extrusion, injection/blow/roto molding, sheet extrusion.`;

// ── Client-approved cold outreach template (verbatim, do not let the LLM rewrite this) ──

export const DEFAULT_EMAIL_INTRO = `It is my pleasure to introduce Kuber Polyplast, a trusted name in the masterbatch industry with over 30 years of experience. As an ISO 9001:2015 certified company based in Delhi, we specialize in delivering top-quality products tailored to meet your needs.`;

export const DEFAULT_EMAIL_OFFERINGS = `Our Offerings:
- Masterbatches: Black, White, Colour and Additive Masterbatches
- Application Suitability: Tested for film extrusion, sheet extrusion, injection molding, blow molding, and roto molding

Key Strengths:
- Annual Production Capacity: 18,000 MT
- Global Presence: Serving 6670+ clients across 40+ countries
- Proven Expertise: Over 57,000 unique masterbatches developed with 1,042,440 hours of experience
- Impressive Revenue: $2.4 billion (₹20,360 crore) client revenue achieved to date

Accolades & Clients:
- Awards: Udaan Award (Rising Star in Masterbatch)
- Trusted Partners: APL Apollo, UFlex, Wipro, Phillips, BSNL, and more`;

export const DEFAULT_EMAIL_CLOSING_WITH_ATTACHMENT = `Please find attached our brochure for further details on how we can support your needs. If you have any questions or would like to discuss further, I'd be happy to assist. We look forward to collaborating with you.`;

export const DEFAULT_EMAIL_CLOSING_NO_ATTACHMENT = `If you have any questions or would like to discuss further, I'd be happy to assist. We look forward to collaborating with you.`;

export type KuberProductMatch = "black" | "white" | "color" | "additive" | "none";

export const DEFAULT_PRODUCT_SECTIONS: Record<Exclude<KuberProductMatch, "none">, string> = {
  black: `Why Choose Our Black Masterbatch?
✔️ Strong Jet Black Appearance
✔️ Excellent UV & Weather Resistance
✔️ High Carbon Black Loading (Up to 55%)
✔️ Outstanding Thermal Stability
✔️ Minimal Grit Content (<50 PPM)
✔️ Particle Size Range: 18–65 nm
✔️ Suitable for PE, PP, PET, PBT, PC, Nylon, PMMA, GPPS, and HIPS applications

We offer both:
- General Purpose Black Masterbatch using SRF/HAF/ISAF Carbon Black
- High-Performance Black Masterbatch using Premium P-Type Carbon Black with antioxidants and processing aids for demanding applications

Global Impact of Our Black Masterbatch
✔️ 500 Million meters of film strengthened and UV-protected, helping farmers safeguard crops.
✔️ 800 Million+ people receive clean and safe water through UV-stable pipes and water storage systems.
✔️ 7,000 tons of crops protected annually, supporting agricultural productivity and global food security.`,

  white: `Why Choose Our White Masterbatch?
✔️ High Opacity & Brilliant Whiteness
✔️ Superior Dispersion & Smooth Processing
✔️ UV & Weather Resistant
✔️ Food Contact Compliant
✔️ TiO₂ Content up to 85%
✔️ Suitable for PE, PP, PS, PET, ABS & EVA Applications

Ideal For: Packaging Films, Injection & Blow Molding, Pipes & Fittings, Woven Sacks, Household Products, Electrical Components, and Food Packaging.

Key Benefits
✔️ Enhanced Brightness & Coverage
✔️ Consistent Color Quality
✔️ Excellent Processing Performance
✔️ Reliable Outdoor Durability
✔️ Outstanding Dispersion in Polymers

Global Impact of Our White Masterbatch
✔️ 50 Billion+ milk pouches whitened annually, helping deliver fresh and hygienic dairy products worldwide.
✔️ 72 Million+ air coolers and air conditioners manufactured every year using high-performance White Masterbatch.
✔️ 31 Million+ households illuminated with durable, aesthetic, and high-quality lighting solutions.`,

  color: `Why Choose Our Color Masterbatch?
✔️ Vibrant & Consistent Colors
✔️ Enhanced Durability & Weather Resistance
✔️ Excellent Dispersion & Process Efficiency
✔️ Wide Application Flexibility
✔️ RoHS & REACH Compliant
✔️ Suitable for PE, PP, PS, PET, ABS, EVA & Universal Applications
✔️ Pigment Loading: 10%–60% | MFI: 5–50 g/10 min
✔️ FPV: <1 in 10 Micron | Thermal Stability: Up to 280–320°C
✔️ Heavy Metal Content: <100 ppm

Special Product Range
- Pearlescent Masterbatch
- Marble Effect Masterbatch
- Fluorescent Masterbatch
- Special Effect Masterbatch
- Phthalate, Lead & Heavy Metal-Free Colors
- Micro-Granule Masterbatch (Dosage @ 0.2%)
- Mono Concentrates for PE / PP / PA / PET

Global Impact of Our Color Masterbatch
✔️ 120 Million+ consumer products made vibrant every day, bringing lasting colors to homes worldwide.
✔️ 80 Million+ toys and consumer goods colored safely, delivering attractive and compliant products.
✔️ 500 Billion+ packaging solutions enhanced with durable and appealing colors, protecting essential products used every day.`,

  additive: `Why Choose Our Additive Masterbatch?
✔️ Eco-Friendly Performance Enhancement
✔️ Excellent UV & Weather Protection
✔️ Superior Slip & Anti-Block Properties
✔️ Improved Process Stability & Productivity
✔️ Suitable for PE, PP, PS, PET, ABS, EVA & Universal Applications
✔️ Additive Content: 5%–40% | MFI: 5–25 g/10 min
✔️ Moisture Content: <0.15% | Thermal Stability: Up to 280–320°C

Range of Additive Masterbatch
- Anti-Blocking, Slip, Anti-Fog, Anti-Static & Desiccant Masterbatches
- UV Stabilizer, Heat Stabilizer, Anti-Oxidant, Flame Retardant & VCI Masterbatches
- Anti-Microbial, Anti-Rodent, Anti-Termite & Odor Absorber Masterbatches
- Clarifier, Nucleating Agent, OB Masterbatch & Light Diffuser Masterbatches
- PIB, PPA, Foaming Agent, Purging Compound & OXO-Biodegradable Masterbatches
- Fragrance, Glow-in-the-Dark, Impact Modifier & Silicon Masterbatch for HDPE Pipes/Ducts

Global Impact of Our Additive Masterbatch
✔️ 200 Million+ Plastic Items Protected with UV stabilizers, ensuring products last longer in daily use.
✔️ 1 Billion+ Packaging Films Enhanced with Slip & Anti-Block additives, delivering smooth processing and reliable performance.
✔️ 72 Lakhs+ Electronics & Appliances Protected with Flame Retardant additives, helping improve safety for homes and industries.`,
};

export const DEFAULT_PRODUCT_HINTS: Record<Exclude<KuberProductMatch, "none">, string> = {
  black: "buys/uses carbon black or jet-black colored plastics, needs UV/weather protection (films, pipes, agri mulch film, water tanks)",
  white: "buys/uses white or opaque plastics, food packaging, dairy pouches, white appliances, white pipes/fittings",
  color: "buys/uses custom/vibrant colored plastics — toys, consumer goods, decorative or branded packaging, pearlescent/special-effect finishes",
  additive: "needs functional plastic additives — UV stabilizers, anti-static, flame retardant, anti-microbial, slip/anti-block, rather than color itself",
};

export const DEFAULT_CAMPAIGN_STEPS = [
  {
    step_order: 1,
    delay: 0,
    delay_unit: "days" as const,
    subject: "{{customSubject}}",
    body: "{{customBody}}",
  },
  {
    step_order: 2,
    delay: 30,
    delay_unit: "days" as const,
    subject: "",  // empty = Instantly threads it as a reply in the same conversation
    body: "Hi {{firstName}},\n\nJust following up on my previous note — would love your thoughts.\n\nBest regards",
  },
  {
    step_order: 3,
    delay: 90,
    delay_unit: "days" as const,
    subject: "",  // empty = threaded
    body: "Hi {{firstName}},\n\nCircling back one final time in case this is useful.\n\nBest regards",
  },
] as const;

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

export const DEFAULT_REPLY_CLASSIFIER_PROMPT = `You are an expert B2B sales reply classifier for Kuber Polyplast, a masterbatch and specialty plastics manufacturer running cold outbound.
You are given the cold email we sent and the prospect's reply. Classify the prospect's intent.

Return ONLY a JSON object, no prose, no markdown:
{
  "temperature": "hot" | "warm" | "cold" | "neutral" | "ooo" | "unsubscribed",
  "interest_status": <integer or null>,   // 1 Interested, 2 Meeting Booked, 3 Meeting Completed, 4 Won, 0 Out of Office, -1 Not Interested, -2 Wrong Person, -3 Lost, or null if unclear
  "reasoning": "<one short sentence>"
}

Definitions:
- hot: clear buying interest, asks for pricing/samples/a call/meeting, or says yes.
- warm: mildly positive or "not now, maybe later", curious but not committing.
- cold: explicitly not interested, "no", "stop", "we already have a supplier", or hostile.
- neutral: replied but intent is genuinely unclear from the text.
- ooo: an out-of-office / auto-reply.
- unsubscribed: asks to be removed / unsubscribe / "do not contact".
Pick the single best label. If they ask to be removed, use "unsubscribed".`;

export const DEFAULT_REPLY_DRAFTER_PROMPT = `You are a sales rep at Kuber Polyplast, a masterbatch and specialty plastics manufacturer (ISO 9001:2015, 30 years, exports to 50+ countries). You are writing a reply to a prospect who responded to our cold email.

Rules:
- Write a natural, concise, human reply that directly addresses what the prospect said.
- Use the prior emails in the thread for context. Do not repeat the whole pitch.
- Match the prospect's tone. If they're interested, move toward a concrete next step (samples, a short call, a spec sheet). If they object, address the objection briefly and helpfully.
- Do NOT include any sign-off, signature, name, title, or contact details — the system appends the signature automatically. End on your final sentence.
- Do NOT use bracketed placeholders like [Your Name].

Return ONLY a JSON object, no prose, no markdown:
{ "subject": "<reply subject, usually 'Re: <original subject>'>", "body": "<reply body, no signature>" }`;
