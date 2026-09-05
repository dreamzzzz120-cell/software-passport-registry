import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PSA_DISPOSITIONS,
  PsaVendorContractUnverified,
  adapterFor,
  claimedStateFor,
  isRejection,
  planFindingUpdate,
  registerPsaAdapter,
  registeredPsaProviders,
  type PsaDisposition,
} from '../src/integrations/psa-finding-sync.ts';
import { FINDING_STATES, VERIFIED_STATES, type FindingState } from '../src/trust/finding-state.ts';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const opts = { ticketId: 'CW-1234', actor: 'tech@msp.example', observedAt: '2026-09-05T12:00:00.000Z' };

describe('a PSA ticket carries a claim, never a verified fact', () => {
  // The load-bearing property of the whole integration. If a vendor webhook can
  // reach a verified state, anyone able to close a ticket can close a
  // vulnerability by asserting it away.
  it('maps no disposition to a verified state', () => {
    for (const disposition of PSA_DISPOSITIONS) {
      const target = claimedStateFor(disposition);
      if (target === null) continue;
      expect(VERIFIED_STATES, `${disposition} -> ${target}`).not.toContain(target);
    }
  });

  it('never plans a verified state from any starting point', () => {
    for (const from of FINDING_STATES) {
      for (const disposition of PSA_DISPOSITIONS) {
        const outcome = planFindingUpdate(from, disposition, opts);
        if (isRejection(outcome)) continue;
        expect(VERIFIED_STATES, `${from} + ${disposition}`).not.toContain(outcome.nextState);
      }
    }
  });

  it('turns a resolved ticket into a remediation claim awaiting verification', () => {
    const outcome = planFindingUpdate('detected', 'resolved_fixed', opts);
    expect(isRejection(outcome)).toBe(false);
    if (isRejection(outcome)) return;
    expect(outcome.nextState).toBe('remediated_claimed');
    expect(outcome.requiresVerification).toBe(true);
    expect(outcome.humanClaimReason).toContain('CW-1234');
    expect(outcome.humanClaimReason).toContain('does not close the finding on its own');
  });

  it('turns a not-applicable ticket into a false-positive claim, not a dismissal', () => {
    const outcome = planFindingUpdate('detected', 'resolved_not_applicable', opts);
    if (isRejection(outcome)) throw new Error('expected a plan');
    expect(outcome.nextState).toBe('claimed_false_positive');
    expect(outcome.requiresVerification).toBe(true);
  });

  it('lets a reopened ticket put a claimed finding back to detected', () => {
    const outcome = planFindingUpdate('remediated_claimed', 'reopened', opts);
    if (isRejection(outcome)) throw new Error('expected a plan');
    expect(outcome.nextState).toBe('detected');
    expect(outcome.requiresVerification).toBe(false);
  });
});

describe('the plan is always a real state', () => {
  // The defect this shape was designed against: the original sketch assigned
  // the result of assertTransition() -- which returns void -- into the state
  // column, writing `state: undefined` for every synchronised finding.
  it('returns a concrete nextState or an explicit rejection, never undefined', () => {
    for (const from of FINDING_STATES) {
      for (const disposition of PSA_DISPOSITIONS) {
        const outcome = planFindingUpdate(from, disposition, opts);
        if (isRejection(outcome)) {
          expect(outcome.code).toBeTruthy();
          expect(outcome.reason).toBeTruthy();
        } else {
          expect(FINDING_STATES, `${from} + ${disposition}`).toContain(outcome.nextState);
          expect(outcome.nextState).toBeDefined();
        }
      }
    }
  });

  it('rejects a disposition that asserts nothing', () => {
    for (const disposition of ['acknowledged', 'unknown'] as PsaDisposition[]) {
      const outcome = planFindingUpdate('detected', disposition, opts);
      expect(isRejection(outcome)).toBe(true);
      if (isRejection(outcome)) expect(outcome.code).toBe('NO_CLAIM');
    }
  });

  it('refuses to let a ticket overturn what a scan verified', () => {
    for (const verified of VERIFIED_STATES as FindingState[]) {
      const outcome = planFindingUpdate(verified, 'resolved_fixed', opts);
      expect(isRejection(outcome)).toBe(true);
      if (isRejection(outcome)) expect(outcome.code).toBe('ALREADY_VERIFIED');
    }
  });
});

describe('the vendor seam is honest about what is not implemented', () => {
  it('refuses an unregistered provider instead of guessing its contract', () => {
    expect(() => adapterFor('connectwise')).toThrow(PsaVendorContractUnverified);
    expect(() => adapterFor('ninjaone')).toThrow(PsaVendorContractUnverified);
    try {
      adapterFor('connectwise');
    } catch (error) {
      expect((error as PsaVendorContractUnverified).code).toBe('PSA_VENDOR_CONTRACT_UNVERIFIED');
      expect((error as Error).message).toContain('will not guess a signature scheme');
    }
  });

  it('accepts a registered adapter', () => {
    registerPsaAdapter({
      provider: 'test-vendor',
      signatureHeader: 'x-test-signature',
      parse: (raw) => ({ ...JSON.parse(raw), disposition: 'resolved_fixed' as PsaDisposition }),
    });
    expect(registeredPsaProviders()).toContain('test-vendor');
    expect(adapterFor('test-vendor').signatureHeader).toBe('x-test-signature');
  });
});

describe('the webhook transport gets the four easy things right', () => {
  const route = read('src/routes/psa-webhooks.ts');
  const server = read('server.ts');

  it('is mounted with a raw body before the JSON parser, like the Stripe webhook', () => {
    const psaIndex = server.indexOf("app.use('/api/psa/webhooks'");
    const jsonIndex = server.indexOf('app.use(express.json(');
    expect(psaIndex).toBeGreaterThan(-1);
    expect(psaIndex).toBeLessThan(jsonIndex);
    expect(server).toContain("app.use('/api/psa/webhooks', express.raw({ type: 'application/json'");
  });

  it('reads the endpoint through a tenant-scoped connection, since the table forces RLS', () => {
    expect(route).toContain('await attachTenantScope(tenantId, res)');
    expect(route).toContain('FROM psa_webhook_endpoints');
    expect(route).not.toMatch(/\bdb\.execute\(/);
  });

  it('decrypts secret_ciphertext through the vault, because there is no plaintext column', () => {
    expect(route).toContain('secret_ciphertext AS "secretCiphertext"');
    expect(route).toContain('decryptCredentials(');
    expect(route).not.toMatch(/SELECT\s+secret\s+FROM/i);
  });

  it('calls the real signature verifier with its real argument order', () => {
    expect(route).toContain('verifyWebhookSignature(secret, rawBody, signature)');
  });

  it('resolves the finding by ticket id, never by an id supplied in the payload', () => {
    expect(route).toContain('WHERE tenant_id = ${tenantId} AND psa_ticket_id = ${event.ticketId}');
    expect(route).not.toContain('event.findingId');
  });

  it('reads Drizzle results through .rows, not by array destructuring', () => {
    expect(route).toMatch(/\)\s*as any\)\.rows\?\.\[0\]/);
  });

  it('answers the same way for an unknown tenant and a bad signature', () => {
    const unauthorized = [...route.matchAll(/UNAUTHORIZED/g)];
    expect(unauthorized.length).toBeGreaterThanOrEqual(2);
  });
});
