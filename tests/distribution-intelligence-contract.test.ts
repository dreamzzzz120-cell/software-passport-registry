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

  it('bounds DNS resolution latency before research continues', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    expect(source).toContain('DNS_TIMEOUT_MS = 2_000');
    expect(source).toContain('DISTRIBUTION_DNS_TIMEOUT');
    expect(source).toContain('Promise.race([dnsPromise, timeoutPromise])');
  });

  it('isolates outbound research fetches from ambient browser state', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    expect(source).toContain("credentials: 'omit'");
    expect(source).toContain("referrerPolicy: 'no-referrer'");
    expect(source).toContain("cache: 'no-store'");
    expect(source).toContain("accept: 'text/html,application/xhtml+xml'");
  });

  it('requires a concrete HTTP origin for research', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    expect(source).toContain("DISTRIBUTION_ORIGIN_INVALID");
  });

  it('rejects encoded hostnames before network access', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    expect(source).toContain("DISTRIBUTION_HOST_ENCODING_BLOCKED");
  });

  it('rejects malformed hosts and oversized research queries', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    expect(source).toContain("DISTRIBUTION_HOST_INVALID");
    expect(source).toContain("DISTRIBUTION_QUERY_TOO_LONG");
    expect(source).toContain("host.includes('..')");
  });

  it('bounds URL, hostname, and DNS response dimensions', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    expect(source).toContain('MAX_RESEARCH_URL_LENGTH = 2048');
    expect(source).toContain('MAX_DNS_ADDRESSES = 16');
    expect(source).toContain("DISTRIBUTION_HOST_INVALID");
    expect(source).toContain("DISTRIBUTION_DNS_ANSWER_LIMIT");
  });

  it('applies the same destination controls to direct research requests', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    expect(source).toContain("parsed.port && parsed.port !== '80' && parsed.port !== '443'");
    expect(source).toContain("parsed.hash");
    expect(source).toContain("parsed.username || parsed.password");
    expect(source).toContain("declaredLength");
  });

  it('refuses to score error pages or non-HTML responses', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    expect(source).toContain("response.status < 200 || response.status >= 300");
    expect(source).toContain("application/xhtml+xml");
    expect(source).toContain("contentType");
  });

  it('enforces a narrow outbound network boundary', () => {
    const source = fs.readFileSync('src/lib/distribution-engine.ts', 'utf8');
    expect(source).toContain('DISTRIBUTION_PORT_NOT_ALLOWED');
    expect(source).toContain('DISTRIBUTION_FRAGMENT_NOT_ALLOWED');
    expect(source).toContain('a >= 224');
    expect(source).toContain("normalized.startsWith('ff')");
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
