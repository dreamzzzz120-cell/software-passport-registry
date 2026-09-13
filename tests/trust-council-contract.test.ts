import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNCIL_SEATS, acceptChair, acceptReview, floorVerdict, type SeatOutcome } from '../src/agents/trust-council.ts';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const seat = COUNCIL_SEATS[0];
const allowed = new Set(['ev_1', 'ev_2', 'finding_9']);
const goodReview = { verdict: 'CONDITIONAL', rationale: 'One high finding is open.', concerns: [{ statement: 'CVE open', severity: 'high', evidenceIds: ['finding_9'] }], unknowns: ['No signature evidence supplied.'], citedIds: ['ev_1'] };

describe('Trust Council reviews are accepted only when grounded', () => {
  it('accepts a review whose every citation is in the snapshot', () => {
    const outcome = acceptReview(seat, goodReview, allowed);
    expect(outcome.status).toBe('reviewed');
    expect(outcome.review?.verdict).toBe('CONDITIONAL');
  });

  it('discards a review that cites an id outside the snapshot, and says why', () => {
    const outcome = acceptReview(seat, { ...goodReview, citedIds: ['ev_1', 'CVE-2024-99999'] }, allowed);
    expect(outcome.status).toBe('discarded');
    expect(outcome.reason).toContain('AI_OUTPUT_UNSUPPORTED_EVIDENCE');
    const viaConcern = acceptReview(seat, { ...goodReview, concerns: [{ statement: 'x', severity: 'low', evidenceIds: ['made_up'] }] }, allowed);
    expect(viaConcern.status).toBe('discarded');
  });

  it('discards malformed output', () => {
    expect(acceptReview(seat, { verdict: 'MAYBE' }, allowed).status).toBe('discarded');
    expect(acceptReview(seat, null, allowed).status).toBe('discarded');
  });

  it('with no evidence at all, only INSUFFICIENT_EVIDENCE is acceptable', () => {
    const empty = new Set<string>();
    expect(acceptReview(seat, { ...goodReview, verdict: 'APPROVE', concerns: [], citedIds: [] }, empty).status).toBe('discarded');
    expect(acceptReview(seat, { ...goodReview, verdict: 'INSUFFICIENT_EVIDENCE', concerns: [], citedIds: [] }, empty).status).toBe('reviewed');
  });
});

describe('the chair cannot be more favourable than the reviewers without saying so', () => {
  const seats: SeatOutcome[] = [
    { seat: 'security', title: 'Security reviewer', status: 'reviewed', review: { ...goodReview, verdict: 'REJECT' } as any, reason: null },
    { seat: 'supply_chain', title: 'Supply-chain & licensing reviewer', status: 'reviewed', review: { ...goodReview, verdict: 'APPROVE' } as any, reason: null },
    { seat: 'vendor', title: 'Vendor & provenance reviewer', status: 'failed', review: null, reason: 'MODEL_CALL_FAILED: timeout' },
  ];

  it('the floor is the least favourable accepted verdict', () => {
    expect(floorVerdict(seats)).toBe('REJECT');
    expect(floorVerdict([])).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('an unexplained upgrade is overruled back to the floor', () => {
    const outcome = acceptChair({ verdict: 'APPROVE', summary: 'Fine.', conditions: [], disagreements: [], citedIds: ['ev_1'] }, seats, allowed);
    expect(outcome.verdict).toBe('REJECT');
    expect(outcome.reason).toContain('CHAIR_OVERRULED');
  });

  it('an explained upgrade stands, and an ungrounded chair is dropped', () => {
    const explained = acceptChair({ verdict: 'CONDITIONAL', summary: 'x', conditions: ['fix'], disagreements: ['Security reviewer’s REJECT rests on finding_9, which has a fixed version.'], citedIds: ['finding_9'] }, seats, allowed);
    expect(explained.verdict).toBe('CONDITIONAL');
    expect(explained.reason).toBeNull();
    const ungrounded = acceptChair({ verdict: 'REJECT', summary: 'x', conditions: [], disagreements: [], citedIds: ['nope'] }, seats, allowed);
    expect(ungrounded.chair).toBeNull();
    expect(ungrounded.verdict).toBe('REJECT');
  });
});

describe('AI provider wiring', () => {
  it('Claude is the primary reasoning model in the scanner and the trust routes, with honest fallbacks', () => {
    const scanner = read('src/utils/scanner.ts');
    expect(scanner).toContain("isClaudeConfigured() ? 'claude' : geminiKey ? 'gemini' : null");
    expect(scanner).toContain('claudeStructured({');
    expect(scanner).toContain('Falling back to secure static compiler');
    const routes = read('src/routes/ai-trust.ts');
    expect(routes).toContain("router.post('/trust-council'");
    expect(routes).toContain("router.post('/ask'");
    expect(routes).toContain("router.get('/ai-status'");
    expect(routes).toContain("if (!isClaudeConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED'");
    expect(read('package.json')).toContain('"@anthropic-ai/sdk"');
  });

  it('council and Q&A never write authoritative state', () => {
    const routes = read('src/routes/ai-trust.ts');
    const tail = routes.slice(routes.indexOf("router.post('/trust-council'"));
    for (const forbidden of ['INSERT INTO evidence_ledger', 'INSERT INTO trust_findings', 'UPDATE passports', 'UPDATE trust_findings']) expect(tail).not.toContain(forbidden);
    expect(tail).toContain('INSERT INTO trust_council_sessions');
    expect(read('migrations/0088_trust_council_sessions.sql')).toContain('trust_council_sessions');
  });

  it('the UI says when no provider is configured instead of pretending', () => {
    const panel = read('src/components/TrustCouncilPanel.tsx');
    expect(panel).toContain("apiFetch('/api/ai-trust/ai-status')");
    expect(panel).toContain('Nothing is simulated in their place.');
  });
});
