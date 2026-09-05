import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_TRANSITIONS,
  FINDING_STATES,
  InvalidFindingTransition,
  assertTransition,
  canTransition,
  countsAsOpen,
  isClaimed,
  isVerified,
  resolveVerification,
  type FindingState,
} from '../src/trust/finding-state.ts';

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('finding state machine', () => {
  it('covers every state with an explicit transition list', () => {
    for (const state of FINDING_STATES) {
      expect(ALLOWED_TRANSITIONS[state], `${state} has no transition list`).toBeDefined();
    }
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...FINDING_STATES].sort());
  });

  // The load-bearing rule. A human claim is not evidence, and there is no edge
  // that turns one into evidence without a scan in between.
  it('never allows a claim to reach a verified state without passing through verification', () => {
    for (const state of FINDING_STATES) {
      if (state === 'under_verification') continue;
      expect(canTransition(state, 'verified_not_affected'), `${state} -> verified_not_affected must be illegal`).toBe(false);
      expect(canTransition(state, 'remediated_verified'), `${state} -> remediated_verified must be illegal`).toBe(false);
    }
    expect(canTransition('under_verification', 'verified_not_affected')).toBe(true);
    expect(canTransition('under_verification', 'remediated_verified')).toBe(true);
  });

  it('lets a fresh detection overrule any earlier conclusion', () => {
    for (const state of FINDING_STATES) {
      if (state === 'detected') continue;
      expect(canTransition(state, 'detected'), `${state} -> detected must stay legal`).toBe(true);
    }
  });

  it('accepts the claim transitions a PSA ticket close produces', () => {
    expect(canTransition('detected', 'claimed_false_positive')).toBe(true);
    expect(canTransition('detected', 'remediated_claimed')).toBe(true);
    expect(canTransition('claimed_false_positive', 'under_verification')).toBe(true);
    expect(canTransition('remediated_claimed', 'under_verification')).toBe(true);
  });

  it('throws on an illegal transition rather than letting it pass', () => {
    expect(() => assertTransition('detected', 'verified_not_affected')).toThrow(InvalidFindingTransition);
    expect(() => assertTransition('detected', 'under_verification')).not.toThrow();
  });
});

describe('verification outcomes', () => {
  const at = '2026-09-05T12:00:00.000Z';

  it('overrules a false-positive claim the scanner disagrees with, and records why', () => {
    const outcome = resolveVerification('claimed_false_positive', true, at);
    expect(outcome.state).toBe('detected');
    expect(outcome.vexStatus).toBe('affected');
    expect(outcome.confidence).toBe(1);
    expect(outcome.reason).toContain('Verification failed');
    expect(outcome.reason).toContain(at);
  });

  it('distinguishes a verified false positive from a verified remediation', () => {
    expect(resolveVerification('claimed_false_positive', false, at)).toMatchObject({
      state: 'verified_not_affected',
      vexStatus: 'not_affected',
    });
    expect(resolveVerification('remediated_claimed', false, at)).toMatchObject({
      state: 'remediated_verified',
      vexStatus: 'fixed',
    });
  });

  it('always lands on a state the machine can legally reach from the claim', () => {
    for (const claim of ['claimed_false_positive', 'remediated_claimed'] as FindingState[]) {
      for (const stillPresent of [true, false]) {
        const outcome = resolveVerification(claim, stillPresent, at);
        expect(canTransition('under_verification', outcome.state), `${claim}/${stillPresent} -> ${outcome.state}`).toBe(true);
      }
    }
  });
});

describe('open-risk accounting', () => {
  it('counts a claim as still open, because nothing has checked it', () => {
    expect(isClaimed('claimed_false_positive')).toBe(true);
    expect(countsAsOpen('claimed_false_positive')).toBe(true);
    expect(countsAsOpen('remediated_claimed')).toBe(true);
  });

  it('counts an accepted risk as still open, because accepting a risk does not remove it', () => {
    expect(countsAsOpen('risk_accepted')).toBe(true);
  });

  it('closes only what a scan actually verified', () => {
    expect(isVerified('verified_not_affected')).toBe(true);
    expect(isVerified('remediated_verified')).toBe(true);
    expect(countsAsOpen('verified_not_affected')).toBe(false);
    expect(countsAsOpen('remediated_verified')).toBe(false);
  });
});

describe('the migration backing these states', () => {
  const migration = read('migrations/0067_finding_vex_reachability_state.sql');

  it('constrains each vocabulary in the database, not only in TypeScript', () => {
    for (const state of FINDING_STATES) expect(migration, state).toContain(`'${state}'`);
    for (const vex of ['not_affected', 'affected', 'fixed', 'under_investigation']) expect(migration, vex).toContain(`'${vex}'`);
    for (const reach of ['reachable', 'unreachable', 'unknown', 'not_analyzed']) expect(migration, reach).toContain(`'${reach}'`);
  });

  it('keeps confidence a probability', () => {
    expect(migration).toContain('CHECK (confidence >= 0 AND confidence <= 1)');
  });

  it('binds a PSA ticket to at most one finding per tenant', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_findings_psa_ticket');
    expect(migration).toContain('ON scan_findings (tenant_id, psa_ticket_id)');
  });

  it('adds columns without dropping or rewriting existing rows', () => {
    expect(migration).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS');
  });
});
