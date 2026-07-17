/**
 * Shared reply-draft selection for Unibox and Campaign Outbox.
 * Drafts are ordered by created_at ascending (oldest → newest).
 */

export type DraftWithEvent = { reply_event_id?: string | null };

/**
 * Drafts to attach to one inbound message.
 * - Older messages: exact reply_event_id match only.
 * - Latest message: prefer event match; if none, fall back to drafts that belong
 *   to no inbound message at all (Unibox-composed) so they still appear in Outbox.
 *
 * A draft tied to a *different* reply event is never borrowed here. It is already
 * rendered under the message it answers, so reusing it would render the same draft
 * twice in one thread — duplicating its React key, which makes React drop one of the
 * two rows. That is what hid a brand-new inbound reply whose reply_event_id was still
 * null (webhook missed; only the Unibox mirror had ingested it).
 */
export function pickDraftsForInboundMessage<T extends DraftWithEvent>(
  allDrafts: T[],
  eventId: string | null | undefined,
  isLatest: boolean,
): T[] {
  if (allDrafts.length === 0) return [];

  if (!isLatest) {
    if (!eventId) return [];
    return allDrafts.filter((d) => d.reply_event_id === eventId);
  }

  if (eventId) {
    const matched = allDrafts.filter((d) => d.reply_event_id === eventId);
    if (matched.length > 0) return matched;
  }

  const unclaimed = allDrafts.filter((d) => !d.reply_event_id);
  if (unclaimed.length === 0) return [];
  return [unclaimed[unclaimed.length - 1]];
}

/** Single latest draft for the latest inbound message (Unibox composer). */
export function pickLatestDraftForThread<T extends DraftWithEvent>(
  latestInboundEventId: string | null | undefined,
  drafts: T[],
): T | null {
  const picked = pickDraftsForInboundMessage(drafts, latestInboundEventId, true);
  return picked[picked.length - 1] ?? null;
}
