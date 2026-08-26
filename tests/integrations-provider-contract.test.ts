import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTEGRATION_CATALOG } from '../src/integrations/catalog.ts';
import { CREDENTIAL_FIELDS } from '../src/integrations/credentialFields.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const NON_GENERIC_PROVIDERS = new Set(['github']);
const genericProviders = INTEGRATION_CATALOG.filter((item) => !NON_GENERIC_PROVIDERS.has(item.provider));

describe('SPR integration provider contracts', () => {
  it('marks every catalog entry live — none silently regress to "planned" without a matching UI section', () => {
    for (const item of INTEGRATION_CATALOG) {
      expect(item.capability, `${item.provider} capability`).toBe('live');
    }
  });

  it('gives every non-GitHub provider a real adapter case in collectProviderEvidence', () => {
    const adapters = read('src/integrations/adapters.ts');
    for (const item of genericProviders) {
      expect(adapters, `adapters.ts missing case for ${item.provider}`).toContain(`case '${item.provider}':`);
    }
  });

  it('gives every non-GitHub provider a credential form matching the fields its adapter actually reads', () => {
    const adapters = read('src/integrations/adapters.ts');
    for (const item of genericProviders) {
      const fields = CREDENTIAL_FIELDS[item.provider];
      expect(fields, `credentialFields.ts missing entry for ${item.provider}`).toBeDefined();
      expect(fields!.length, `${item.provider} has no fields defined`).toBeGreaterThan(0);
      for (const field of fields!) {
        expect(adapters, `adapters.ts never reads credentials.${field.key} for ${item.provider}`).toContain(`credentials.${field.key}`);
      }
    }
  });

  it('never claims a provider is connected without the encrypted credential round-trip actually succeeding', () => {
    const routes = read('src/routes/integrations-live.ts');
    // status flips to LIVE only inside the same transaction that inserts real evidence from collectProviderEvidence.
    expect(routes).toMatch(/collectProviderEvidence\([\s\S]*?db\.transaction[\s\S]*?status = 'LIVE'/);
    // A provider request failure (network/HTTP/credential) maps to an honest error, never a 200.
    expect(routes).toContain("if (/CREDENTIAL_|PROVIDER_|UNSUPPORTED_|HTTP_/.test(message)) return res.status(502)");
  });

  it('fails closed instead of silently no-op-ing when either integration encryption key is unset', () => {
    const integrationVault = read('src/integrations/credential-vault.ts');
    expect(integrationVault).toContain("throw new Error('INTEGRATION_MASTER_KEY_MISSING')");
    const securityVault = read('src/security/credential-vault.ts');
    expect(securityVault).toContain("throw new Error('SPR_CREDENTIAL_ENCRYPTION_KEY is required')");
  });

  it('keeps the two credential vaults (provider integrations vs. webhooks) on distinct env vars so one missing key cannot mask the other', () => {
    const integrationVault = read('src/integrations/credential-vault.ts');
    const securityVault = read('src/security/credential-vault.ts');
    expect(integrationVault).toContain('SPR_INTEGRATION_MASTER_KEY');
    expect(securityVault).toContain('SPR_CREDENTIAL_ENCRYPTION_KEY');
    expect(integrationVault).not.toContain('SPR_CREDENTIAL_ENCRYPTION_KEY');
    expect(securityVault).not.toContain('SPR_INTEGRATION_MASTER_KEY');
  });

  it('keeps the dead fake-success onboarding checklist out of the reachable app tree', () => {
    // PilotOnboardingChecklist.tsx PUTs to /api/integrations/:id, a route that
    // does not exist, and hardcodes fake connected-state values. It must stay
    // unreferenced so it can never be reached from a real user flow; if this
    // starts failing, either the component was wired back in (fix it for real
    // first) or it now calls a real endpoint (delete this guard).
    const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }) as string[];
    const referencingFiles = files
      .filter((f) => typeof f === 'string' && f.endsWith('.tsx') && !f.endsWith('PilotOnboardingChecklist.tsx'))
      .filter((f) => read(path.join('src', f)).includes('PilotOnboardingChecklist'));
    expect(referencingFiles).toEqual([]);
  });
});
