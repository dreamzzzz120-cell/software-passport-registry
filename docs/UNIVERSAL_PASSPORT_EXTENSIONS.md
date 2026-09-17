# Universal Passport Extensions

SPR now exposes two extension capabilities on the existing extension registry:

- **Product Passport** — persistent identity and evidence workflow for physical products.
- **AI Passport** — persistent identity and evidence workflow for AI systems.

## Shared trust fabric

Both extensions intentionally reuse the existing SPR workflow rather than creating parallel trust engines:

`Identity → Raw Evidence → Normalization → Evidence Graph → Canonical Verification → Passport → Monitoring`

### Product Passport

The workflow is designed around observed or supplied evidence for:

- manufacturer and origin
- materials and composition
- components
- ownership or custody transfers
- repairs and maintenance
- recalls
- product claims and verification history
- lifecycle changes

### AI Passport

The workflow is designed around observed or supplied evidence for:

- AI system identity and version
- model identity
- data lineage
- permissions and integrations
- evaluation evidence
- security evidence
- deployment and lifecycle changes
- operational monitoring

## Safety and evidence rules

- `UNKNOWN` remains a valid state when evidence is absent.
- The extensions do not manufacture certifications, provenance, ownership, safety claims, or model evaluations.
- A passport presentation is not itself a certification.
- Existing tenant authorization and canonical evidence surfaces remain the source of truth.
- Extension pages link to canonical SPR surfaces instead of creating duplicate records.

## Current implementation boundary

The extensions are **wired into the existing extension marketplace and workflow registry** and use the existing passport, evidence, and monitoring surfaces. They are intentionally not a new parallel database or scoring system.

A future dedicated product/AI intake schema can be added once real customer workflows establish the required fields. Until then, the UI must remain evidence-first and must not imply that a field is populated merely because the extension exists.
