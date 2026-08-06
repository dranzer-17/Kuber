import type { SupabaseClient } from "@supabase/supabase-js";
import { onlyRevealedLeads } from "@/lib/server/lead-visibility";

export type ImportRow = {
  id: string;
  label: string;
  source: string;
  lead_count: number;
  color: string;
  created_at: string;
  [key: string]: unknown;
};

/**
 * Company import batches for the Leads filter dropdown.
 *
 * Managers see every batch. Employees only see batches that still contain at
 * least one revealed lead assigned to them — otherwise the filter lists
 * company-wide imports they cannot open any rows for.
 *
 * When `assignedTo` is set, `lead_count` is rewritten to that employee's
 * assigned count so the badge matches what they actually see after filtering.
 */
export async function getImports(
  db: SupabaseClient,
  opts?: { assignedTo?: string },
): Promise<ImportRow[]> {
  const { data, error } = await db
    .from("imports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const imports = (data ?? []) as ImportRow[];
  if (!opts?.assignedTo) return imports;

  const visible: ImportRow[] = [];
  for (const imp of imports) {
    const { count } = await onlyRevealedLeads(
      db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("import_id", imp.id)
        .eq("assigned_to", opts.assignedTo)
        .eq("is_deleted", false),
    );
    const n = count ?? 0;
    if (n > 0) visible.push({ ...imp, lead_count: n });
  }
  return visible;
}
