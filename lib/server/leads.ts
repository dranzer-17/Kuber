import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDbLead, type DbLead } from "@/lib/mappers";

const LEAD_SELECT = `*, organizations(id, name, domain, description, unsubscribed, has_scraped,
  primary_products, competitors, news_summary, intent_signals, enrichment_stage,
  company_description, sells_to, last_error),
  campaign_leads(crm_status, interest_status, created_at, campaigns(id, name))`;

export async function getLeads(
  db: SupabaseClient,
  opts: { limit?: number; page?: number; organizationId?: string } = {},
) {
  const { limit = 200, page = 1, organizationId } = opts;
  let q = db.from("leads").select(LEAD_SELECT, { count: "exact" }).eq("is_deleted", false);
  if (organizationId) q = q.eq("organization_id", organizationId);
  q = q.order("created_at", { ascending: false }).range((page - 1) * limit, page * limit - 1);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { leads: (data ?? []).map((l: any) => mapDbLead(l as unknown as DbLead)), total: count ?? 0 };
}
