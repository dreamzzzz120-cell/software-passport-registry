# M2M Trust Core

Canonical shared protocol contracts for machine-to-machine trust across SPR and Constellation.

This package is infrastructure, not a third customer-facing product.

## Responsibilities
- machine identity references
- authority and delegation envelopes
- trust request evaluation
- replay/expiry checks
- fail-closed trust states
- evidence receipts

## Trust states
`VERIFIED | PARTIAL | UNKNOWN | DENIED | REVOKED | EXPIRED`

`UNKNOWN` and `PARTIAL` must never be promoted to `VERIFIED` without fresh verification evidence.

SPR is authoritative for passport/registry state. Constellation is authoritative for runtime observation and accountability. This package defines the interoperability contract between them.
