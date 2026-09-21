import { describe, expect, it } from 'vitest';

describe('distribution lead quality contracts', () => {
  it('gates research-sourced contacts on score + a real industry signal', async () => {
    const { ingestResearchResult } = await import('../src/lib/distribution-outreach.ts');
    await expect(ingestResearchResult({url:'https://example-software-project.dev',score:90,signals:{msp:false,cybersecurity:false,compliance:false,psa:false},publicRoleEmails:['info@example-software-project.dev']},'legitimate_interest')).resolves.toBe(0);
    await expect(ingestResearchResult({url:'https://tiny-msp.example',score:20,signals:{msp:true,cybersecurity:false,compliance:false,psa:false},publicRoleEmails:['sales@tiny-msp.example']},'legitimate_interest')).resolves.toBe(0);
    await expect(ingestResearchResult({url:'https://real-msp.example',score:95,signals:{msp:true,cybersecurity:true,compliance:true,psa:true},publicRoleEmails:[]},'legitimate_interest')).resolves.toBe(0);
  });
  it('requires an MSP/security/compliance keyword before qualify_lead can score', async () => {
    const source=(await import('node:fs')).readFileSync('src/workers/distribution-worker.ts','utf8');
    expect(source).toContain('function scoreQualifyLead');
    expect(source).toContain('if (!mspSignal) return { score: 0, businessEmail, mspSignal };');
  });
  it('raises the qualify_lead contact threshold to 45', async () => {
    const source=(await import('node:fs')).readFileSync('src/lib/distribution-outreach.ts','utf8');
    expect(source).toContain("DISTRIBUTION_QUALIFY_LEAD_CONTACT_THRESHOLD ?? '45'");
  });
  it('rejects code-hosting/social/blog domains as discovery candidates', async () => {
    const {dedupeDiscoveryResults,isNonBusinessDomain}=await import('../src/lib/distribution-discovery.ts');
    expect(isNonBusinessDomain('github.com')).toBe(true);
    expect(isNonBusinessDomain('sub.github.com')).toBe(true);
    expect(isNonBusinessDomain('acme-msp.com')).toBe(false);
    const results=dedupeDiscoveryResults([{url:'https://github.com/acme/repo',source:'github-repository-search',discoveredAt:new Date().toISOString()},{url:'https://acme-msp.com',source:'github-repository-search',discoveredAt:new Date().toISOString()}]);
    expect(results.map(r=>r.url)).toEqual(['https://acme-msp.com']);
  });
  it('GitHub fallback requires a real external homepage', async () => {
    const source=(await import('node:fs')).readFileSync('src/workers/distribution-worker.ts','utf8');
    expect(source).toContain("if(!homepage||!/^https?:\\/\\//i.test(homepage))return[];");
    expect(source).toContain('if(isNonBusinessDomain(hostname))return[];');
    expect(source).not.toContain('const repoUrl=typeof row?.html_url');
  });
});
