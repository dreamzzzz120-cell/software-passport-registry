# SPR Security Incident Response Runbook

Status: production operating procedure  
Owner: SPR platform operator  
Last reviewed: 2026-10-07

This runbook is an operational procedure, not a certification claim. It applies to suspected compromise, cross-tenant exposure, credential leakage, unauthorized access, evidence-integrity failures, payment/webhook abuse, malicious uploads, supply-chain compromise, and production outages with security impact.

## 1. Declare and classify

Create an incident record as soon as a credible security impact is suspected. Record only the minimum necessary facts and preserve uncertainty explicitly.

Severity:

| Severity | Examples | Initial response target |
| --- | --- | --- |
| SEV-1 | confirmed cross-tenant exposure; active credential compromise; unauthorized production write; evidence ledger integrity failure | immediate |
| SEV-2 | credible exploit path with no confirmed exposure; compromised third-party integration; sustained auth bypass attempts | within 1 hour |
| SEV-3 | contained security defect; suspicious event requiring investigation; vulnerable dependency without observed exploitation | same business day |
| SEV-4 | hardening opportunity or low-risk policy deviation | normal backlog |

Do not downgrade a case because impact is unknown. Unknown impact stays UNKNOWN until evidence resolves it.

## 2. Preserve evidence first

Before destructive remediation, preserve the evidence needed to reconstruct what happened:

- timestamps in UTC;
- deployment and commit identifiers;
- affected tenant, route, service and job identifiers where known;
- relevant audit-trail hashes and evidence IDs;
- sanitized application, worker, proxy and identity-provider logs;
- affected configuration names and versions, never plaintext secrets;
- Stripe event IDs for billing incidents;
- repository commit SHA and scan ID for supply-chain incidents.

Do not paste credentials, session tokens, API keys, private customer data or raw secrets into tickets, chat, commits or incident notes.

## 3. Contain

Use the smallest containment that stops the suspected harm while preserving unaffected service.

Examples:

- revoke or rotate the affected credential;
- disable the affected integration or worker path;
- stop a compromised deployment and roll back to a known-good commit;
- pause outbound distribution rather than deleting its job history;
- disable billing checkout if live/test mode or webhook integrity cannot be confirmed;
- block a vulnerable route behind an explicit fail-closed response;
- quarantine an uploaded object or repository result rather than marking it clean;
- invalidate affected sessions when identity compromise is confirmed.

For a possible cross-tenant issue, treat tenant isolation as the primary security boundary and stop the affected path until isolation is verified.

## 4. Investigate from authoritative sources

Prefer authoritative evidence in this order when applicable:

1. persisted SPR audit/evidence records and database state;
2. identity-provider session/factor state;
3. Railway deployment, runtime and proxy logs;
4. GitHub commit, PR and CI history;
5. Stripe signed event history for payment incidents;
6. third-party provider logs for the affected integration.

A UI symptom is not proof of the underlying state. Reproduce against the authoritative API/database path before concluding that data was created, lost, exposed or modified.

## 5. Eradicate and repair

Repair the root cause, not only the visible symptom. Every production security fix must include a regression test or an explicit reason why one cannot be automated.

Required review questions:

- Does the fix preserve tenant scope and RLS?
- Can a transient dependency failure be mistaken for authorization state?
- Does UNKNOWN remain UNKNOWN?
- Can retries duplicate a charge, email, execution or evidence record?
- Could logs or error messages expose secrets?
- Does rollback restore a vulnerable state?
- Are migrations backward-compatible and safe on an upgraded database?

## 6. Verify recovery

Before declaring recovery:

- required CI/security/release gates are green;
- the production deployment is running the intended commit;
- health/readiness checks pass;
- affected queues have no stale running work;
- the original failure path is retested;
- tenant isolation is rechecked when relevant;
- audit/evidence integrity checks pass when relevant;
- billing mode and webhook signature handling are verified when relevant;
- no temporary bypass, debug credential or emergency rule remains enabled.

A successful deploy alone does not close an incident.

## 7. Communicate

For incidents affecting customer confidentiality, integrity, availability, billing or contractual commitments, prepare a factual notice containing:

- what is known;
- what remains unknown;
- affected time window;
- affected data or function;
- containment taken;
- customer action required, if any;
- next update time.

Do not state that data was not accessed merely because no access has yet been observed.

Legal/regulatory notification requirements depend on facts and jurisdiction and must be evaluated for the specific incident; this runbook does not replace legal advice.

## 8. Close and learn

Close only after the production verification above is complete. Record:

- root cause;
- detection source;
- timeline;
- scope and impact;
- containment and repair;
- regression coverage;
- monitoring added or changed;
- follow-up owner and due date.

For SEV-1 and SEV-2 incidents, complete a post-incident review before the follow-up work is considered finished.

## Emergency checklist

```text
[ ] Declare severity and UTC start time
[ ] Preserve evidence before destructive changes
[ ] Contain the affected path
[ ] Check tenant/isolation impact
[ ] Rotate/revoke compromised credentials if confirmed
[ ] Identify known-good deployment/commit
[ ] Repair with regression coverage
[ ] Run security/release gates
[ ] Verify production commit + readiness
[ ] Check queues/retries/idempotency
[ ] Re-test original failure
[ ] Prepare customer/legal notification if applicable
[ ] Document root cause and follow-up
```
