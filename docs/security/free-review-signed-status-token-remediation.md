# Signed Free Review status polling: remediation and acceptance

## Observed production risk
The browser obtains `/api/free-review/scan/{passportId}/status/{token}` and performs GET polling with an opaque bearer token in the request path. The Railway HTTP proxy logs complete request paths. This is a **credential exposure surface**; logging controls cannot be repaired by frontend analytics redaction alone.

## Applied narrow mitigation
The Free Review polling `fetch` now sets `referrerPolicy: 'no-referrer'`. This can reduce referrer propagation from that request; **it does not remove the token from Railway logs**, and is not the complete fix. No auth weakening or forced routing migration.

## Required complete migration (not implemented)
1. Locate actual server status route and authorization validation. Keep legacy route temporarily.
2. Add `POST /api/free-review/scan/:passportId/status` (or equivalent) with the signed token only in a secure request header, never the URL/query string. Header/field name must avoid generic logging and APM collection.
3. Retain signature, purpose, expiry, and passport binding checks; validate malformed/mismatched/expired tokens and tenant scope.
4. Implement strict no-store; no tokens in access logs, analytics, analytics referrers, exception messages or telemetry.
5. Switch browser polling to new route. Prevent cross-origin API requests and token forwarding on redirects; test preflight and browser credentials.
6. Test old and new endpoints with a nonproduction signed fixture and count actual proxy logs. Avoid printing real tokens or fixture secrets.
7. Deploy behind a compatibility feature flag; watch failures, then retire token-in-URL endpoint after existing links expire.

## Acceptance
- Client referrer mitigation typecheck and regression test: **UNKNOWN until CI returns**.
- Backend header-based endpoint: **NOT IMPLEMENTED**.
- Real proxy log token removal: **NOT VERIFIED**.
- Existing public share links: **unchanged** by mitigation.
- No invented test passes, customer events or collected payments.
