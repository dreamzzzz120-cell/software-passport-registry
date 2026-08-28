import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Trust Response: security-questionnaire automation. The most genuinely new
// module of the four built this session -- no existing table, route, or UI
// covered any part of this, unlike Vendor Risk/ClientOps/Portal which were
// largely wiring dormant or partial pieces together.
describe('questionnaires schema', () => {
  it('is tenant-scoped with RLS, matching every other tenant table', () => {
    const migration = read('migrations/0037_trust_response_questionnaires.sql');
    expect(migration).toContain("CREATE POLICY spr_tenant_isolation ON questionnaires USING (tenant_id = current_setting(''app.tenant_id'', true))");
    expect(migration).toContain("CREATE POLICY spr_tenant_isolation ON questionnaire_items USING (tenant_id = current_setting(''app.tenant_id'', true))");
  });

  it('is a living document, not an immutable ledger -- no append-only trigger, unlike the audit/observation tables', () => {
    const migration = read('migrations/0037_trust_response_questionnaires.sql');
    expect(migration).not.toContain('IMMUTABLE');
  });
});

describe('questionnaire matching never fabricates an answer (routes wiring)', () => {
  const source = () => read('src/routes/questionnaires.ts');

  it('generate-drafts pulls real trust_findings and runs them through the real matcher, not a placeholder', () => {
    const s = source();
    expect(s).toContain("import { matchQuestionToEvidence, type QuestionnaireFinding } from '../trust/questionnaire-matcher.ts';");
    expect(s).toContain('const match = matchQuestionToEvidence(item.questionText, findings);');
  });

  it('never overwrites a human-approved item when re-running the matcher', () => {
    expect(source()).toContain("if (item.status === 'APPROVED') continue;");
  });

  // Real defect, found via live adversarial testing: questionnaires
  // required and validated a passportId at creation but never persisted
  // it, so generate-drafts matched against every trust_findings row for
  // the questionnaire's client across every passport that client has, not
  // just the one the questionnaire was actually created for.
  it('persists the passport a questionnaire was created for', () => {
    expect(source()).toContain('INSERT INTO questionnaires (id, tenant_id, client_id, passport_id, name, status, created_by, created_at, updated_at)');
  });

  it('scopes findings to the questionnaire\'s own passport, not just its client', () => {
    expect(source()).toContain('AND (${questionnaire.passportId}::text IS NULL OR passport_id = ${questionnaire.passportId})');
  });

  it('verifies the passport and client belong to the caller\'s tenant before creating a questionnaire', () => {
    const s = source();
    expect(s).toContain("if (!passport) return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });");
    expect(s).toContain("if (!client) return res.status(404).json({ error: 'CLIENT_NOT_FOUND' });");
  });

  it('restricts questionnaire creation and draft generation to staff roles', () => {
    const s = source();
    expect(s).toContain("router.post('/', requireAuth, requireRole(['Owner', 'Admin', 'Technician'])");
    expect(s).toContain("router.post('/:id/generate-drafts', requireAuth, requireRole(['Owner', 'Admin', 'Technician'])");
  });
});

describe('QuestionnairesView is wired to the real API', () => {
  const source = () => read('src/components/QuestionnairesView.tsx');

  it('creating a questionnaire and generating drafts both call real endpoints', () => {
    const s = source();
    expect(s).toContain("apiFetch('/api/questionnaires', {");
    expect(s).toContain('/generate-drafts`, { method: \'POST\' }');
  });

  it('shows an explicit "no matching evidence" state instead of a blank or fabricated answer', () => {
    expect(source()).toContain('No matching evidence found for this question.');
  });
});
