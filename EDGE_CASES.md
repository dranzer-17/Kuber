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

## 3. Leads

### 3.1 Employees see only leads directly assigned to them — not campaign-based access (Med — inconsistent with Unibox)
`GET /api/v1/leads` filters employees strictly to `assigned_to = me`; there's no "leads in a campaign I'm part of" visibility, unlike Unibox threads (§4.1) which do combine campaign access with lead-assignment. An employee who's the assignee of a campaign built from someone else's leads can work those leads' *reply threads* in Unibox but can't see the underlying **lead record** itself in the Leads page. That's a real, user-facing inconsistency.

### 3.2 Lead reassignment isn't possible via the lead edit endpoint at all (Low, but worth confirming intentional)
`PATCH /api/v1/leads/[id]`'s schema has no `assigned_to` field — the only way to move a lead between owners is bulk-assign (manager-only) or campaign-assign-with-reassign (manager-only, as a side effect). There's no single-lead "reassign this one lead" action for a manager who just wants to hand off one lead — they have to go through bulk-assign.

### 3.3 Duplicate import always favors the earliest-created row, silently (Med)
When two different users import the same email (via Apollo search or Excel), the second import is just skipped as a duplicate — the **original assignee wins**, with no prompt telling the second importer "this lead already exists and is owned by someone else." If User B imports a lead thinking they now own it, they don't, and nothing tells them.

### 3.4 Org-level enrichment fans out to every lead under that org, regardless of owner (High — directly answers a scenario named in the prompt)
Enrichment (`company_description`, `sells_to`, scrape status) is written once per `organization_id` and then applied to **every lead under that org**, even leads owned by completely different employees who never triggered the enrichment. So: if Employee A's lead and Employee B's lead belong to the same organization, and Employee A enriches it, **Employee B's lead's org data changes too**, with no notification to B that their lead's data just changed underneath them.

### 3.5 Concurrent enrichment of the same org can double-fire external calls (Med)
The self-chaining `scrape-orgs` route selects queued orgs, then marks them `scraping` — but the select-then-update isn't atomic. Two concurrent invocations can both pick up the same org before either marks it `scraping`, causing duplicate Firecrawl/LLM spend and duplicate log rows (last write wins, no row lock). Low-probability but real, and gets worse under load/retry storms.

### 3.6 Lead delete cascades are asymmetric (pre-send vs. post-send) (Low — seems intentionally designed, but note the asymmetry)
Deleting a lead hard-deletes pre-send `campaign_leads`/unsent drafts, but only "closes" (keeps history for) post-send memberships and explicitly deletes the corresponding Instantly-side lead to stop follow-ups. Reply/Unibox rows referencing the deleted lead are left in place — harmless today since scope checks key off `is_deleted`, but worth flagging if any future UI surfaces raw thread history without checking that flag.

### 3.7 Bulk-assign to a territory only "splits" leads if strategy = territory/round_robin — "manual" mode sends the whole batch to one person (Med — directly answers a scenario named in the prompt)
`bulkAssignByStrategy` (`lib/services/assignment.ts:90-138`) behaves completely differently depending on which mode the manager picks for the bulk action:
- **`manual`** (a specific assignee chosen): **all** selected leads go to that one person — a manager selecting 30 India leads and picking "Employee A" gives all 30 to A, none to B, regardless of territory.
- **`territory`** (or `round_robin`): leads are distributed **one at a time**, each going to whichever eligible candidate currently has the **lower total assigned-lead count** (`LoadBalancedPicker.pick`, lines 71-80), with a round-robin cursor breaking exact ties. So 30 India leads with two active India reps *do* split — roughly 15/15 if both reps started with equal loads, but skewed toward whichever rep had fewer leads *in total* (not just India leads) beforehand, since the load signal is a global per-employee lead count, not a territory-scoped one.
- Auto-assignment of newly-enriched leads (`autoAssignEnrichedLeads`/`resolveAssignee`, lines 141-186) uses the exact same least-loaded-first logic per lead as they trickle in one at a time — so freshly-enriched India leads landing over time will also alternate between the two India reps rather than piling onto whichever rep happened to be assigned the first one.
- There is no "split evenly N-ways regardless of current load" option and no preview before committing — the manager finds out the split after clicking Assign, not before.

---

## 4. Unibox

### 4.1 Thread visibility combines campaign access OR lead-assignment fallback (Med — the flip side of §3.1)
An employee sees a reply thread if they either have campaign access **or** the underlying lead is assigned to them — whichever is broader. Combined with §3.1, this means an employee can have full reply-thread visibility/reply rights on a lead they cannot see or edit as a Lead record. That's confusing for the employee ("I can talk to this person but can't see their lead card") and worth resolving toward one consistent rule.

### 4.2 No "who sent it" attribution on outbound replies (Med — audit/accountability gap)
`sendThreadReply` records no sender user id — only the sending mailbox (`eaccount`). If two people have access to the same thread (via the OR-fallback above) and one sends a reply, there's no way to later determine which teammate actually sent it, which matters if a customer complains about a reply's content or tone.

### 4.3 Stale sub-campaign webhook data could drop a reply silently (Low/Med)
If a lead is removed from Campaign A and re-enrolled in Campaign B under the same email, inbound replies are matched by `(campaign_id, lead_id)` against the *current* Instantly sub-campaign. If old webhook data still references the stale sub-campaign, the match can resolve to "no campaign_lead found" and the reply is effectively dropped rather than mis-filed against the wrong lead (safer failure mode, but still a silent loss worth logging/alerting on).

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
