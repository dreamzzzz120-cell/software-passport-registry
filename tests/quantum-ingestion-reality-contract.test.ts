import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/agents/public-repository-team-v2.ts'), 'utf8');

describe('quantum ingestion reality contract', () => {
  it('resolves the default branch to an actual commit SHA instead of relabeling pushed_at', () => {
    expect(source).toContain('/commits/');
    expect(source).toContain("/^[a-f0-9]{40}$/i");
    expect(source).toContain('pushedAt:');
    expect(source).not.toContain('headSha:typeof item?.pushed_at');
  });

  it('preserves uncertainty when GitHub cannot prove the tree or manifest state', () => {
    expect(source).toContain("manifestPresent:boolean|null");
    expect(source).toContain("sourceStatus:'verified'|'partial'");
    expect(source).toContain('if(reality.manifestPresent===false)');
    expect(source).not.toContain('if(!await hasSupportedManifest');
  });

  it('records every crawler reality check in the immutable living-registry observation path', () => {
    expect(source).toContain('software_registry_identities');
    expect(source).toContain('software_registry_observations');
    expect(source).toContain("'github-reality'");
    expect(source).toContain('latest_commit_sha');
    expect(source).toContain('observation_count=software_registry_identities.observation_count+1');
  });

  it('keeps registry identity IDs distinct from ingestion work-item IDs', () => {
    expect(source).toContain("const ledgerId = (c:Candidate) => \`reging_");
    expect(source).toContain("function identityId(c:Candidate){return \`reg_");
  });

  it('records proven unsupported repositories before excluding them from scan scheduling', () => {
    const recordIndex = source.indexOf('const identity=await recordRegistryReality(pool,c,reality,run)');
    const excludeIndex = source.indexOf('if(reality.manifestPresent===false)');
    expect(recordIndex).toBeGreaterThan(-1);
    expect(excludeIndex).toBeGreaterThan(recordIndex);
    expect(source).toContain('repository observed but excluded: complete tree contains no supported manifest');
  });

  it('propagates reality quality into ingestion rather than fabricating certainty', () => {
    expect(source).toContain("r.sourceStatus==='verified'?'good':'partial'");
    expect(source).toContain('head_sha=COALESCE($6,head_sha)');
    expect(source).toContain("refresh_reason");
  });
});
