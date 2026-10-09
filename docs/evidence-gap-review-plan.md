# Evidence gaps and proposed review work

The plain-English report now derives a review plan from the canonical report. It is available through the existing tenant/client-scoped report endpoint and appears in Reports > plain-English explanation. Users can copy evidence questions or download the full plan as text. Browser print can include the section; the legacy PDF generator and public-share templates are not upgraded by this change.

The plan preserves unresolved finding IDs/control IDs, source status, provider, observation time, URL, verification method, hash and limitations where supplied. Unknown dimensions remain aggregate coverage information; the plan does not invent unnamed controls or add overlapping counts into a distinct-risk total. A limitation on a verified record remains unresolved coverage. Unsupported finding statuses are explained as unknown instead of falling through to a resolved explanation.

Each proposed item contains a reason, conditional explanation of significance, evidence request, source-owner question, next step, suggested recipient and closure criteria. Owners are explicitly unassigned. Copy/download performs no external send, assignment, task creation, evidence write, verification, score change or authorization. Vendor responses require review and fresh observations before status changes. A reviewer must still establish client intended use and make a separate suitability decision.

This increment replaces manual preparation of an evidence-gap follow-up list for supported reports. It does not establish replacement of RMM, GRC, vulnerability scanning or a complete vendor review system. No unique-market or time-saved claims are introduced.

## Validation

Run typecheck, build, the full test suite and focused evidence-gap/report tests. The added behavioral tests cover absent evidence, orphan unknown source records, aggregate unknowns, verified records with limitations, duplicate limitations, unexpected finding statuses, repository unknown findings, malformed evidence references, plan immutability, escaped source text, clipboard failure and download cleanup.

## Production acceptance

Generate an authenticated report containing a real unknown check. Confirm questions and exports reproduce that report's source records and hash. Generate a report with resolved findings but remaining limitations and confirm it does not say nothing needs attention. Check another tenant/client cannot access it through the existing report authorization. Validate a long report on mobile and browser print. Production deployment, visual acceptance and measured time savings remain UNKNOWN until observed. No new migrations or environment variables are required.

## Snapshot consistency

ReportsView passes the loaded canonical snapshot directly to the plain-English presentation. No second report is generated or fetched for the summary. Historical snapshots and reloaded reports therefore retain their own findings, questions, timestamps and hashes. The plan displays the snapshot timestamp and report hash; absent hashes remain explicitly unavailable.
