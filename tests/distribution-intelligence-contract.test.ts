import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('distribution intelligence hardening', () => {
  it('captures multiple fit signals and routes to an observed offer category', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    for (const signal of ['vendorRisk', 'softwareSupplyChain', 'procurement', 'vCiso']) {
      expect(source).toContain(signal);
    }
    expect(source).toContain('fitReasons');
    expect(source).toContain('recommendedOffer');
    expect(source).toContain('Math.min(100');
  });

  it('keeps discovery focused on high-fit software-risk and MSP use cases', () => {
    const source = fs.readFileSync('src/lib/distribution-discovery.ts', 'utf8');
    for (const query of ['software vendor risk', 'software supply chain SBOM', 'vendor assessment due diligence', 'vCISO']) {
      expect(source).toContain(query);
    }
  });

  it('keeps outreach evidence-based and points prospects to the real free-review route', () => {
    const source = fs.readFileSync('src/lib/distribution-outreach.ts', 'utf8');
    expect(source).toContain('public site references');
    expect(source).toContain('/free-review');
    expect(source).toContain('observed evidence retained');
  });
});
