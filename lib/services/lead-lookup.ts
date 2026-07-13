import type { SupabaseClient } from "@supabase/supabase-js";

/** Escape PostgREST LIKE/ILIKE wildcards so an email's `_` or `%` isn't a wildcard. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Case-insensitive, soft-delete-aware lookup of a lead id by email.
 * Returns the OLDEST active match deterministically, or null.
 *
 * Replaces the fragile `.eq("email", …).maybeSingle()` used for reply
 * attribution, which was case-sensitive (Apollo emails aren't lowercased) and
 * silently returned null — dropping the reply — whenever duplicate emails existed.
 */
export async function findActiveLeadIdByEmail(
  db: SupabaseClient,
  email: string | null | undefined,
): Promise<string | null> {
  const norm = email?.trim().toLowerCase();
  if (!norm) return null;
  const { data, error } = await db
    .from("leads")
    .select("id")
    .ilike("email", escapeLike(norm))
    .eq("is_deleted", false)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].id as string;
}
