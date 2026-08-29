import { describe, expect, it } from 'vitest';
import { scanFindingIdentity } from './scan-finding-identity.ts';

describe('scan finding stable identity', () => {
  it('deduplicates the same logical finding across repeated scan jobs', () => {
    const base = {
      tenantId: 'tenant-1',
      passportId: 'passport-1',
      engineId: 'spr-secret-scanner-v1',
      category: 'Hardcoded Secret',
      title: 'AWS access key committed in config/production.yml',
      component: 'config/production.yml',
    };
    // Same logical finding re-detected on a later scan run has a different
    // job id but must produce the same identity, otherwise it duplicates.
    expect(scanFindingIdentity(base)).toBe(scanFindingIdentity({ ...base }));
  });

  it('keeps genuinely different findings distinct', () => {
    const base = {
      tenantId: 'tenant-1',
      passportId: 'passport-1',
      engineId: 'spr-secret-scanner-v1',
      category: 'Hardcoded Secret',
      title: 'AWS access key committed in config/production.yml',
      component: 'config/production.yml',
    };
    expect(scanFindingIdentity(base)).not.toBe(
      scanFindingIdentity({ ...base, title: 'Stripe secret key committed in config/production.yml' })
    );
    expect(scanFindingIdentity(base)).not.toBe(scanFindingIdentity({ ...base, component: 'config/staging.yml' }));
  });

  it('treats a missing component as a stable empty string, not undefined vs null drift', () => {
    const base = {
      tenantId: 'tenant-1',
      passportId: 'passport-1',
      engineId: 'spr-iac-config-scanner-v1',
      category: 'Insecure IaC Configuration',
      title: 'S3 bucket allows public read',
    };
    expect(scanFindingIdentity({ ...base, component: null })).toBe(scanFindingIdentity({ ...base, component: undefined }));
  });
});
