import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Real production bug, found via live testing: a passport with no owning
// MSP client (client_id null -- a real, supported state) had its OWN id
// substituted as a fake client id in the /collect route. evidence_ledger and
// trust_findings silently accepted the fabricated value (client_id is
// NOT NULL there but has no foreign key), but trust_observations has a real
// foreign key to clients(id), so the nonexistent client id violated it and
// every provider's collection failed for that passport with a 500.
describe('trust-loop /collect never fabricates a client id for a client-less passport', () => {
  it('does not substitute passport.id for a missing client_id', () => {
    const routeSource = read('src/routes/trust-loop.ts');
    expect(routeSource).not.toContain('clientId: passport.client_id || passport.id');
    expect(routeSource).toContain('clientId: passport.client_id ?? null');
  });

  it('persistTrustLoop no longer requires a truthy clientId', () => {
    const coreSource = read('src/trust/trust-loop.ts');
    expect(coreSource).not.toContain('!input.tenantId||!input.passportId||!input.clientId||!input.assetId');
    expect(coreSource).toContain('!input.tenantId||!input.passportId||!input.assetId');
  });
});
