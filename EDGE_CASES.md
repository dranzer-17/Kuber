# Edge Cases Audit — Roles, Leads, Campaigns, Unibox

Read-only analysis of the current implementation's business-logic edge cases: situations where ownership, visibility, or state can diverge in ways the code allows but the product probably didn't intend. Every item is grounded in the actual route/service code, not hypothetical. No fixes applied — this is a punch list to triage.

Severity: **High** = data/ownership corruption, security-relevant, or silent data loss. **Med** = confusing UX or inconsistent rule enforcement, no data loss. **Low** = cosmetic/nice-to-have.

---

## 1. Roles & Users

### 1.7 No audit trail for lead reassignment (Med)
Campaign assignment has an append-only `campaign_assignments` table recording who/when/previous-assignee. Lead assignment has no equivalent — `assigned_at` is simply overwritten. If a lead's ownership is disputed later ("I was working this lead, why did it move?"), there's no history to check.

---

## 2. Campaigns

### 2.3 Campaigns can mix leads from multiple employees with no ownership check (High)
When a manager adds leads to a campaign (`POST /api/v1/campaigns/[id]/leads`), there is **no filter requiring the leads' `assigned_to` to match the campaign's `created_by`/`assigned_to`.** A manager can freely build one campaign out of leads belonging to Employee A, Employee B, and unassigned pool leads simultaneously. This is exactly the scenario named in the prompt — **it is currently allowed with no warning, and nothing tracks "this campaign contains leads from N different owners."**

### 2.4 Campaign assignment can silently reassign leads to a third employee (High)
`POST /api/v1/campaigns/[id]/assign` with `reassign_leads=true` overwrites `leads.assigned_to` for **every lead currently in `campaign_leads`** to the new campaign assignee — including leads that were never that assignee's to begin with (e.g. leads originally owned by Employee A, added to a campaign by a manager, campaign then reassigned to Employee C: all those leads now silently become Employee C's, with no notice to Employee A). There's also no lock against reassigning an already-assigned campaign — every "assign" call is a no-questions-asked overwrite, and clicking the same assignee twice ("second click") still re-runs the lead-reassignment side effect.

### 2.5 Territory is never checked at campaign-assignment time (Med)
The assign endpoint validates only that the new assignee is `is_active` — it never checks whether that employee's territory matches the leads in the campaign. A campaign full of India leads can be assigned to a Foreign-territory rep with no warning.

### 2.6 A lead can be enrolled in multiple active campaigns simultaneously (Med)
The duplicate-guard in `campaigns/[id]/leads` only blocks re-adding a lead to the **same** campaign twice — there is no cross-campaign guard. The same lead can be actively worked in two different outreach campaigns at once, risking duplicate/conflicting emails to the same contact.

### 2.7 Lead ownership and campaign ownership drift apart permanently, by default (High)
Adding a lead to a campaign never touches `leads.assigned_to`; only the explicit assign-with-`reassign_leads` flow does. So in the common case — a manager builds a campaign from various employees' leads — `lead.assigned_to` and the campaign's `created_by`/`assigned_to` diverge **indefinitely**, with real access consequences (see §2.8–2.9), and no UI surface currently makes this divergence visible at a glance.

### 2.8 Draft approval authority follows the campaign, not the lead (Med — inconsistent with reply-drafts)
Whether an employee can approve/reject/edit an initial-outreach draft is gated by campaign access (`created_by`/`assigned_to` on the *campaign*), not by whether the underlying lead is assigned to them. Concretely: if Lead L is assigned to Employee C but sits inside Campaign X (owned by Employee A), **Employee A can approve C's lead's draft while C cannot** (unless C also happens to be the campaign's creator/assignee).

### 2.9 Reply-draft access has a lead-based fallback that initial drafts don't (Med — inconsistent rule across nearly-identical features)
`assertReplyDraftAccess` falls back to "is this lead assigned to me?" when campaign access fails, so an employee whose lead got pulled into someone else's campaign keeps access to *reply* drafts but not *initial* drafts for the exact same lead. This asymmetry is confusing and worth resolving one way or the other.

### 2.10 Campaign steps/report editable by mere assignee, propagates to live sending (Med)
Anyone who is the campaign's `assigned_to` (not just the original `created_by`) can edit sequence steps (subject/body/delay), and that edit propagates live to the Instantly sub-campaign already sending. A manager reassigning a campaign as a "who owns follow-up" administrative move also silently hands over the ability to change what's actively being sent.

---

## 3. Leads — all items resolved

- **3.1** Employees now see (read-only) leads in a campaign they have access to, not just leads directly assigned to them — matches Unibox's model. Fixed in `app/api/v1/leads/route.ts`, `app/api/v1/leads/[id]/route.ts`, `app/api/v1/organizations/[id]/route.ts` via `getCampaignAccessibleLeadIds` (`lib/auth/scope.ts`).
- **3.2** Managers can now reassign a single lead directly (`PATCH /api/v1/leads/[id]` accepts `assigned_to`, manager-only) — surfaced as an "Owner" control in the lead drawer.
- **3.3** Apollo/Excel imports now return `duplicate_owners` (who already owns each skipped duplicate) and the import UI shows it via a toast.
- **3.4** Org-level enrichment fan-out (by design — one profile per org, shared by all its leads) now leaves an `audit_log` entry when it touches leads across multiple owners, and the lead drawer shows "this profile is shared with N other leads" so the current viewer isn't blindsided.
- **3.5** `scrape-orgs` claims its batch atomically via a new `claim_queued_orgs` RPC (`FOR UPDATE SKIP LOCKED`) instead of select-then-update, closing the concurrent-pickup race.
- **3.6** Documented as intentional in `lib/services/lead-removal.ts` — pre-send data is hard-deleted, post-send history (reply_events/unibox_emails/reply_drafts) is left in place and relies on existing `is_deleted` scoping.
- **3.7** Territory-based load balancing (`lib/services/assignment.ts`) is now scoped to the region being routed, not an employee's total lead count — a rep's unrelated cross-territory assignments no longer skew how many new regional leads they get next.

---

## 4. Unibox — all items resolved

- **4.1** Resolved as a side effect of §3.1 — lead visibility now matches thread visibility, so an employee who can reply to a thread can also see the underlying Lead record.
- **4.2** Outbound replies now record `sent_by` (`unibox_emails.sent_by`, new column) — set only for replies sent through our own reply endpoints, never overwritten by resync. The thread view shows the actual sender's name instead of a hardcoded "You" for every outbound message.
- **4.3** The webhook now distinguishes "resolved the campaign + lead but no active `campaign_leads` link" (the stale-sub-campaign case) from a generic unmapped reply, logging it to `audit_log` (action `reply_unmapped_stale_campaign_link`) plus a `console.error` for visibility — the `reply_events` row was already kept either way.

---

## 5. Cross-cutting scenarios (the "what if" list)

These are compound scenarios combining the above, worth explicitly deciding the intended behavior for:

1. **Manager A builds a campaign from Employee B's and Employee C's leads, then assigns the campaign to Employee D with "reassign leads" on.** Result today: B and C silently lose their leads to D; neither is notified. *(§2.3, §2.4)*
2. **Two managers both edit the same campaign's steps at the same time.** No optimistic-locking/version check found — last write wins, no conflict warning.
3. **A manager deactivates an employee who is mid-approval on 40 drafts.** Drafts stay in whatever state they were; no one is auto-notified to pick up the queue; the employee's session dies immediately (§1.4).
4. **An employee's territory is changed after leads were already assigned under their old territory.** Existing `assigned_to` leads are untouched (territory is only consulted at assignment-time, not continuously); only *new* auto-assignments would honor the new territory.
5. **The same lead is simultaneously a member of two active campaigns run by two different employees.** Both can draft/send outreach to the same contact independently — no cross-campaign collision detection *(§2.6)*.
6. **A lead is deleted while its reply thread is open in Unibox for another user.** The thread keeps working (no FK/is_deleted enforcement on unibox routes noted) — worth confirming whether that's desired or should be blocked.
7. **The last active manager deactivates themselves or gets deactivated by another manager moments earlier.** Regular managers have no floor (resolved as intentional — only the last Super Admin is protected); self-deactivation is still open, see §1.3.
8. **A regular (non-super-admin) manager wants to restrict what other managers can see/do.** Resolved — Super Admin exclusively controls manager accounts (create/edit/deactivate/demote); full campaign visibility across managers is confirmed intentional (managers are collaborators, not siloed).
9. **30 India leads are bulk-selected with two active India-territory employees.** Splits leads-first / least-loaded-first between the two *only* if the manager runs the bulk action with strategy `territory` or `round_robin`; picking `manual` with one named assignee dumps all 30 on that one person instead *(§3.7)*.
