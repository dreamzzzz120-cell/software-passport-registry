import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('public software registry provenance visibility', () => {
  const src = readFileSync(new URL('../src/routes/software-registry.ts', import.meta.url), 'utf8');

  it('counts only persisted verified evidence and signature evidence', () => {
    expect(src).toContain("count(*) FILTER (WHERE verified = 1)");
    const schema = readFileSync(new URL('../src/db/schema.ts', import.meta.url), 'utf8');
    expect(schema).toContain("verified: integer('verified').notNull().default(0)");
    expect(src).toContain("count(*) FILTER (WHERE lower(type) = 'signature')");
  });

  it('renders verified and signature counts on repository detail pages', () => {
    expect(src).toContain('Verified evidence');
    expect(src).toContain('Signature evidence');
    expect(src).toContain('entry.verifiedEvidenceCount');
    expect(src).toContain('entry.signatureEvidenceCount');
  });

  it('does not conflate commit provenance with an artifact hash', () => {
    expect(src).not.toContain('Artifact hash');
    expect(src).toContain('cryptographic provenance');
  });

  it('keeps the latest completed review as the public current observation', () => {
    expect(src).toContain('ROW_NUMBER() OVER (PARTITION BY lower(s.repository_owner), lower(s.repository_name) ORDER BY j.created_at DESC)');
    expect(src).toContain('WHERE c.rn = 1');
  });
});
