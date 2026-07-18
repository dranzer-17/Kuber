import { fetchWithRetry, sleep } from "@/lib/http";
import { requireServiceSecret } from "@/lib/services/service-keys";
import {
  APOLLO_TITLES,
  APOLLO_SENIORITIES,
  CONTACT_EMAIL_STATUSES,
  EMPLOYEE_RANGES,
} from "@/lib/constants";

const BASE = "https://api.apollo.io/api/v1";

// Async because the key now resolves through Settings > Keys (DB first,
// .env.local as the fallback tier) instead of being read straight off
// process.env at module scope.
async function headers() {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    accept: "application/json",
    "x-api-key": await requireServiceSecret("apollo", "Apollo"),
  };
}

export interface ApolloSearchPerson {
  id: string;
  first_name: string | null;
  title: string | null;
  has_email: boolean;
  // Location comes back on search results too — stored at insert so
  // territory-based assignment can route the batch immediately (Phase 4).
  city?: string | null;
  state?: string | null;
  country?: string | null;
  organization: {
    id?: string;
    name: string | null;
  } | null;
}

export interface ApolloSearchResult {
  total_entries: number;
  people: ApolloSearchPerson[];
}

export async function searchPeople(opts: {
  keyword: string;
  locations: string[];
  page: number;
  perPage?: number;
  titles?: string[];
  seniorities?: string[];
}): Promise<ApolloSearchResult> {
  const body: Record<string, unknown> = {
    person_titles: opts.titles ?? APOLLO_TITLES,
    person_seniorities: opts.seniorities ?? APOLLO_SENIORITIES,
    q_keywords: opts.keyword,
    organization_num_employees_ranges: EMPLOYEE_RANGES,
    contact_email_status: CONTACT_EMAIL_STATUSES,
    include_similar_titles: false,
    per_page: opts.perPage ?? 100,
    page: opts.page,
  };

  if (opts.locations.length > 0) {
    body.person_locations = opts.locations;
  }

  const res = await fetchWithRetry(
    "apollo",
    `${BASE}/mixed_people/api_search`,
    { method: "POST", headers: await headers(), body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Apollo search ${res.status}: ${text}`), {
      status: res.status,
    });
  }

  return res.json();
}

export interface ApolloBulkMatchPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_status: string | null;
  headline: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  time_zone: string | null;
  email_domain_catchall: boolean | null;
  seniority: string | null;
  departments: string[] | null;
  is_likely_to_engage: boolean | null;
  organization_id: string | null;
  organization: {
    id: string | null;
    name: string | null;
    primary_domain: string | null;
    website_url: string | null;
    industry: string | null;
    keywords: string[] | null;
    estimated_num_employees: number | null;
    city: string | null;
    country: string | null;
  } | null;
}

export interface ApolloBulkMatchResult {
  status: string;
  unique_enriched_records: number;
  missing_records: number;
  credits_consumed: number;
  matches: ApolloBulkMatchPerson[];
}

export async function bulkMatch(
  details: Array<{ id: string; first_name?: string | null; organization_name?: string | null }>
): Promise<ApolloBulkMatchResult> {
  const res = await fetchWithRetry(
    "apollo",
    `${BASE}/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false`,
    {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({
        details: details.map((d) => ({
          id: d.id,
          ...(d.first_name ? { first_name: d.first_name } : {}),
          ...(d.organization_name ? { organization_name: d.organization_name } : {}),
        })),
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Apollo bulk_match ${res.status}: ${text}`), {
      status: res.status,
    });
  }

  return res.json();
}

/** Chunk an array and run bulk_match with 500ms sleep between chunks */
export async function bulkMatchChunked(
  details: Array<{ id: string; first_name?: string | null; organization_name?: string | null }>,
  chunkSize = 10
): Promise<{ results: ApolloBulkMatchResult[]; totalCredits: number }> {
  const results: ApolloBulkMatchResult[] = [];
  let totalCredits = 0;

  for (let i = 0; i < details.length; i += chunkSize) {
    const chunk = details.slice(i, i + chunkSize);
    const result = await bulkMatch(chunk);
    results.push(result);
    totalCredits += result.credits_consumed ?? 0;
    if (i + chunkSize < details.length) await sleep(500);
  }

  return { results, totalCredits };
}
