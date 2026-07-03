import type { JWK } from "@supabase/auth-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

type Jwks = { keys: JWK[] };

let cached: Jwks | null = null;
let inflight: Promise<Jwks> | null = null;

/** Fetch and cache the project JWKS (shared across all getClaims calls). */
export async function getProjectJwks(): Promise<Jwks> {
  if (cached?.keys.length) return cached;
  if (!SUPABASE_URL) return { keys: [] };

  if (!inflight) {
    inflight = fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, {
      cache: "force-cache",
    })
      .then((r) => (r.ok ? r.json() : { keys: [] }))
      .then((j: Jwks) => {
        cached = j;
        return j;
      })
      .catch(() => ({ keys: [] }))
      .finally(() => { inflight = null; });
  }

  return inflight;
}

/** Warm JWKS in the background on server startup / first import. */
if (typeof process !== "undefined" && SUPABASE_URL) {
  void getProjectJwks();
}
