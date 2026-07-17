import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { assertLeadAccess } from "@/lib/auth/scope";

type EventMeta = {
  assignee_id?: string;
  to?: string;
  from?: string;
  campaign_id?: string;
} | null;

// Clean, human-readable per-lead activity timeline for the drawer (Problem 8).
// Distinct from /api/enrich/status, which is the raw org-scrape debug trail.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const db = createAdminClient();
  // Employees may only see their own assigned leads' activity.
  try { await assertLeadAccess(db, user, id); } catch (r) { return r as Response; }

  const { data: events, error } = await db
    .from("lead_events")
    .select("event, detail, actor_id, metadata, created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return fail(500, "INTERNAL", error.message);

  // Resolve every referenced profile in one pass: actors ("by <name>") plus
  // assignment targets, so the timeline can say "Assigned to <name>" instead
  // of the generic "Assigned to an employee" (works for old rows too, since
  // the ids have always been kept in metadata).
  const profileIds = new Set<string>();
  for (const e of events ?? []) {
    if (e.actor_id) profileIds.add(e.actor_id as string);
    const m = e.metadata as EventMeta;
    if (m?.assignee_id) profileIds.add(m.assignee_id);
    if (m?.to) profileIds.add(m.to);
    if (m?.from) profileIds.add(m.from);
  }
  const profileNames = new Map<string, string>();
  if (profileIds.size > 0) {
    const { data: profiles } = await db.from("profiles").select("id, full_name, email").in("id", [...profileIds]);
    for (const p of profiles ?? []) profileNames.set(p.id as string, (p.full_name || p.email) as string);
  }

  // Resolve campaign names so the drawer can render them as links.
  const campaignIds = [...new Set(
    (events ?? []).map((e) => (e.metadata as EventMeta)?.campaign_id).filter(Boolean) as string[],
  )];
  const campaignNames = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: campaigns } = await db.from("campaigns").select("id, name").in("id", campaignIds);
    for (const c of campaigns ?? []) campaignNames.set(c.id as string, c.name as string);
  }

  function preciseDetail(e: { event: string; detail: string | null; metadata: unknown }): string | null {
    const m = e.metadata as EventMeta;
    if (e.event === "assigned" && m?.assignee_id) {
      const name = profileNames.get(m.assignee_id);
      if (name) return `Assigned to ${name}`;
    }
    if (e.event === "reassigned" && m?.to) {
      const to = profileNames.get(m.to);
      const from = m.from ? profileNames.get(m.from) : null;
      if (to) return from ? `Reassigned from ${from} to ${to}` : `Reassigned to ${to}`;
    }
    return e.detail;
  }

  return ok({
    events: (events ?? []).map((e) => {
      const m = e.metadata as EventMeta;
      const campaignId = m?.campaign_id ?? null;
      return {
        event: e.event,
        detail: preciseDetail(e),
        actor_name: e.actor_id ? (profileNames.get(e.actor_id as string) ?? null) : null,
        campaign_id: campaignId,
        campaign_name: campaignId ? (campaignNames.get(campaignId) ?? null) : null,
        created_at: e.created_at,
      };
    }),
  });
}
