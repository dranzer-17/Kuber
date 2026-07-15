import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

// Clean, human-readable per-lead activity timeline shown in the lead drawer —
// deliberately separate from enrichment_logs (the raw org-scrape debug trail
// full of HTTP 402 dumps). Only meaningful, user-facing milestones land here.
export type LeadEventType =
  | "created"
  | "enriched"
  | "enrichment_failed"
  | "assigned"
  | "reassigned"
  | "unassigned"
  | "added_to_campaign"
  | "removed_from_campaign"
  | "draft_created"
  | "draft_approved"
  | "draft_sent"
  | "reply_received"
  | "status_changed";

/**
 * Fire-and-forget: never let activity logging break the actual operation.
 * `detail` is the one-line summary rendered in the drawer.
 */
export async function logLeadEvent(
  db: Db,
  leadId: string,
  event: LeadEventType,
  detail: string,
  opts?: { actorId?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    await db.from("lead_events").insert({
      lead_id: leadId,
      event,
      detail,
      actor_id: opts?.actorId ?? null,
      metadata: opts?.metadata ?? null,
      created_at: new Date().toISOString(),
    });
  } catch {
    /* activity logging must never throw into the caller */
  }
}

/** Bulk variant for logging the same event across many leads in one insert. */
export async function logLeadEvents(
  db: Db,
  rows: Array<{ leadId: string; event: LeadEventType; detail: string; actorId?: string | null; metadata?: Record<string, unknown> }>,
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.from("lead_events").insert(
      rows.map((r) => ({
        lead_id: r.leadId,
        event: r.event,
        detail: r.detail,
        actor_id: r.actorId ?? null,
        metadata: r.metadata ?? null,
        created_at: new Date().toISOString(),
      })),
    );
  } catch {
    /* non-fatal */
  }
}
