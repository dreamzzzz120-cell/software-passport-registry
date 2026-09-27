BEGIN;

-- The old SLSA intake accepted a submitter-supplied statement and hash, then
-- recorded VERIFIED even though no signature, signer identity, transparency
-- proof or artifact bytes were checked. Downgrade those historical rows.
-- Historical trust scores may have counted verified=1. Invalidate those
-- measurements until the canonical scoring engine recalculates from current
-- evidence; do not preserve a potentially inflated value.
CREATE TEMP TABLE spr_unsigned_provenance_affected ON COMMIT DROP AS
SELECT DISTINCT tenant_id, asset_id AS passport_id
FROM evidence_items
WHERE type = 'Attestation'
  AND name = 'SLSA Provenance Attestation'
  AND engine_id = 'provenance-verifier'
  AND status = 'VERIFIED';

UPDATE evidence_items
SET verified = 0,
    status = 'OBSERVED',
    verification_failure_reason = 'SIGNATURE_NOT_VERIFIED'
WHERE type = 'Attestation'
  AND name = 'SLSA Provenance Attestation'
  AND engine_id = 'provenance-verifier'
  AND status = 'VERIFIED';

UPDATE passports p
SET overall_score = NULL,
    security_score = NULL,
    compliance_score = NULL,
    vendor_reputation_score = NULL,
    confidence_score = NULL,
    evidence_completeness = NULL,
    verification_status = 'unverified'
FROM spr_unsigned_provenance_affected a
WHERE p.id = a.passport_id AND p.tenant_id = a.tenant_id;

COMMIT;
