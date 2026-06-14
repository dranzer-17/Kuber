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

export const EMPLOYEE_RANGES = ["10,200", "200,1000"];

export const CONTACT_EMAIL_STATUSES = ["verified", "likely to engage"];

/** Maps UI dropdown label → Apollo person_locations[] value */
export const LOCATION_MAP: Record<string, string> = {
  India: "India",
  Bangladesh: "Bangladesh",
  "Sri Lanka": "Sri Lanka",
  Pakistan: "Pakistan",
  "United States": "United States",
  Poland: "Poland",
  "Czech Republic": "Czech Republic",
  Romania: "Romania",
  UAE: "United Arab Emirates",
  "Saudi Arabia": "Saudi Arabia",
  Turkey: "Turkey",
  Vietnam: "Vietnam",
  Thailand: "Thailand",
  Indonesia: "Indonesia",
  Malaysia: "Malaysia",
  Egypt: "Egypt",
  Nigeria: "Nigeria",
  Kenya: "Kenya",
  Brazil: "Brazil",
  Mexico: "Mexico",
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

export const KUBER_CONTEXT = `Kuber Polyplast is an Indian masterbatch and specialty compounds manufacturer with 30 years of experience. They are ISO 9001:2015 certified and export to 50+ countries worldwide. Their product range includes colour masterbatches, white masterbatches, black masterbatches, additive masterbatches, and specialty compounds for the plastics processing industry.`;

export const DEFAULT_FOLLOW_UP_PATTERN = [
  { step: 1, delay: 0 },
  { step: 2, delay: 30 },
  { step: 3, delay: 90 },
];
