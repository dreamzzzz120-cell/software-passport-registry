import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('security scanner commit resolution contract', () => {
  it('copies the resolved GitHub commit SHA into the scan commit variable', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/workers/security-scanner-worker.ts'), 'utf8');
    expect(source).toContain('const commit: any = await commitResponse.json()');
    expect(source).toContain('commitSha = commit.sha;');
    expect(source).not.toContain('commitSha = commitSha;');
  });

  it('persists GitHub-verified commit signatures as VERIFIED provenance without treating the commit SHA as an artifact hash', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/workers/security-scanner-worker.ts'), 'utf8');
    expect(source).toContain("verification?.verified === true && verification?.reason === 'valid'");
    expect(source).toContain("'GitHub verified commit signature','Signature',1,'VERIFIED','github.com'");
    expect(source).toContain("'github-commit-verification-v1'");
    expect(source).toContain("schemaVersion: 'spr.github-commit-verification.v1'");
    expect(source).not.toContain("artifactHash: commitSha");
  });
});
