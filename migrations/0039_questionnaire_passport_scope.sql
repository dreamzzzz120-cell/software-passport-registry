BEGIN;

-- Real defect, found via live adversarial testing: POST /api/questionnaires
-- requires and validates a passportId (the whole point of Trust Response is
-- matching against a *specific* passport's evidence), but never actually
-- persisted it on the questionnaires row -- so generate-drafts matched
-- against every trust_findings row for the questionnaire's client, across
-- every passport that client has, not just the one the questionnaire was
-- created for. For a tenant with multiple passports per client, this could
-- draft an answer sourced from the wrong software's evidence entirely.
ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS passport_id text;
CREATE INDEX IF NOT EXISTS questionnaires_passport_idx ON questionnaires (tenant_id, passport_id);

COMMIT;
