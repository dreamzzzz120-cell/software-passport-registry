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

  it('blocks credentialed and cloud metadata research targets', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    expect(source).toContain('DISTRIBUTION_CREDENTIALS_IN_URL_BLOCKED');
    expect(source).toContain('metadata.google.internal');
    expect(source).toContain('DISTRIBUTION_METADATA_TARGET_BLOCKED');
  });

  it('stops followups after an observed reply', () => {
    const source = fs.readFileSync('src/lib/distribution-outreach.ts', 'utf8');
    expect(source).toContain("kind IN ('reply','inbound_reply')");
    expect(source).toContain("next_followup_at=NULL");
  });

  it('keeps the public security page crawlable', () => {
    const robots = fs.readFileSync('public/robots.txt', 'utf8');
    expect(robots).toContain('Allow: /security/');
    expect(robots).not.toContain('Disallow: /security');
  });

  it('keeps outreach evidence-based and points prospects to the real free-review route', () => {
    const source = fs.readFileSync('src/lib/distribution-outreach.ts', 'utf8');
    expect(source).toContain('public site references');
    expect(source).toContain('/free-review');
    expect(source).toContain('observed evidence retained');
  });
});
