import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { assertLeadAccess } from "@/lib/auth/scope";

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

  // Resolve actor names in one pass so the timeline can show "by <name>".
  const actorIds = [...new Set((events ?? []).map((e) => e.actor_id).filter(Boolean) as string[])];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await db.from("profiles").select("id, full_name, email").in("id", actorIds);
    for (const p of profiles ?? []) actorNames.set(p.id as string, (p.full_name || p.email) as string);
  }

  return ok({
    events: (events ?? []).map((e) => ({
      event: e.event,
      detail: e.detail,
      actor_name: e.actor_id ? (actorNames.get(e.actor_id as string) ?? null) : null,
      created_at: e.created_at,
    })),
  });
}
