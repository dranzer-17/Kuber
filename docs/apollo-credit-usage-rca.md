# Root Cause Analysis: Apollo Credit Consumption

| | |
|---|---|
| **Issue** | Apollo credits being consumed faster than expected |
| **Reported by** | Client |
| **Date prepared** | 2026-07-30 |
| **Status** | Resolved — fixes applied |
| **System** | Lead import & enrichment pipeline |

## 1. Summary

Apollo credits were being consumed faster than expected during lead imports. Investigation traced this to four separate, independent gaps in how the import and enrichment pipeline used the Apollo API — not one single bug, but several smaller issues that all pushed spend in the same direction. Each has a confirmed root cause and a corresponding fix, detailed below. One related question — whether Apollo itself bills for requests that fail before a reply is received — could not be confirmed from our side and is addressed separately in Section 5.

## 2. Background

Every Apollo import runs in two steps:

1. **Search** — the app searches Apollo for people matching an industry, job title, and location. This step is free.
2. **Reveal** — for each person found, the app asks Apollo for their actual email address. **This step costs 1 credit per person, every time it's asked** — regardless of whether Apollo has an email on file for that person. If Apollo responds "no email available," that credit is still spent, and repeating the request later does not change the answer — it reflects a permanent gap in Apollo's own data, not a temporary failure.

Because of that last rule, one part of the system was already correct going in: the moment Apollo reports "no email" for someone, that person is permanently removed from the pipeline so they're never asked about again, even in a future import. This was working as intended and was not a contributing cause.

## 3. Root Causes

### 3.1 No limit on retries when Apollo itself is slow or errors out

When Apollo's servers are briefly slow, rate-limited, or return an error, the system automatically retries — normal and expected behavior. The gap was in what happened if the failure *persisted*: the same batch of people was simply requeued and retried again by the automatic 15-minute check, indefinitely, with no upper limit.

**Example:** a batch of 10 people is submitted to Apollo. Apollo is degraded and every attempt times out. The system retries a few times immediately, then gives up for that pass — but 15 minutes later, the automatic watchdog picks the same 10 people back up and tries again. And again, every 15 minutes, for as long as the failure persists. If any of those attempts reached Apollo's servers before timing out on our end, Apollo may have billed for it despite no successful reply ever coming back — meaning the same 10 people could be charged for repeatedly, for zero usable result.

By comparison, the part of the system that scrapes company websites already had a "give up after 3 tries" rule. The Apollo email-lookup step had no equivalent — this was the core gap.

### 3.2 No visibility into the actual remaining credit balance

A "check credits" feature existed in Settings, but it only confirmed whether the Apollo key was *valid* — not how many credits remained. As a result, there was no way to notice the balance dropping quickly until it was already gone.

### 3.3 No cap on import size

Import size was governed only by "pages to search" (up to 20) per keyword, with no ceiling when multiple keywords were selected at once. These multiplied together with no limit — a handful of keywords at a high page count could queue up thousands of people for the paid reveal step in a single submission, with no warning.

### 3.4 Shared credit pool between internal testing and the live account

The internal/development environment and the live client account were both connected to the same Apollo key. Any searching or testing performed internally, unrelated to the client account, drew from the same shared credit balance.

## 4. Corrective Actions

| # | Fix | Addresses |
|---|-----|-----------|
| 1 | Retries on a failed batch now stop permanently after 3 attempts, instead of being retried every 15 minutes indefinitely. (Leads that receive a direct "no email" answer from Apollo were already dropped instantly, in the same pass, with zero retries — that behavior is unchanged.) | 3.1 |
| 2 | Settings now displays the real, live Apollo credit balance, not just key validity. | 3.2 |
| 3 | Import size is now capped, with a "strict" mode limiting an import to a small, safe tier (25 / 50 / 100 people). The limit is chosen before import and enforced by the system. | 3.3 |
| 4 | The internal/development environment is now blocked from using Apollo entirely — no internal activity can draw on the shared credit balance. | 3.4 |
| 5 | The system now checks the real remaining balance before spending. If only 40 credits remain, it processes exactly 40 and stops, rather than attempting 50 and failing partway through. The same principle now applies to other paid data sources (e.g. Firecrawl) wherever a batch could run out mid-way. | 3.2, 3.3 |

## 5. Open Item: Does Apollo bill for requests that fail before a reply is received?

This question sits entirely on Apollo's side, not ours — whether a credit is used is decided inside Apollo's own systems at the moment a request is received, before their reply ever reaches us.

Apollo's own documentation points toward "no charge" in this situation. Their API documentation describes server errors as "rare and temporary, and safe to retry," and their pricing documentation states that credits are used only when Apollo actually returns data. Taken together, this indicates that a request which never receives a real reply should not be billed — the work was never completed, so there is nothing to charge for.

Apollo does not state this as a formal, written guarantee, so rather than rely on it as an assumption, it can be confirmed directly: Apollo's dashboard includes a Credit Usage History page (Settings → Billing → Credit usage) that logs every credit charge with a timestamp, including a "Show refunds" toggle. Cross-referencing that log against the timestamps of failed requests recorded on our side would give a definitive, Apollo-sourced answer.

Regardless of the outcome, this scenario is already contained by the fix in Section 4.1 — a persistently failing batch now stops after 3 attempts rather than being retried indefinitely, capping the exposure even under the worst-case reading of Apollo's behavior.

## 6. References

- [Apollo API Pricing & Credits](https://docs.apollo.io/docs/api-pricing)
- [Apollo API FAQs](https://docs.apollo.io/docs/apollo-api-faqs)
- [Apollo Help Center — Review Credit Usage](https://knowledge.apollo.io/hc/en-us/articles/9527776320781-Review-Credit-Usage-in-Apollo)
- [Apollo Enrichment API Overview (2026), Generect](https://generect.com/blog/apollo-enrichment-api/)
