# Authorization Security Test Matrix

Release-blocking invariants for protected application routes.

| Attack | Required result |
|---|---|
| Cross-tenant object read | Deny |
| Cross-tenant mutation | Deny |
| Forged tenant identifier | Ignore/reject |
| Object-ID substitution / IDOR | Deny |
| Client-supplied role escalation | Deny |
| Unverified identity | Deny |
| Revoked token reuse | Deny |
| Evidence mutation/deletion | Deny unless explicitly authorized by immutable workflow |
| Public Passport leakage | Expose only intentionally public fields |
| Missing authentication | Deny |

A test is not considered passing merely because the UI hides a control. The
server-side route must enforce the boundary independently of the client.
