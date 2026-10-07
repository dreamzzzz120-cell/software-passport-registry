import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = () => fs.readFileSync(path.join(root, 'src/agents/public-repository-team-v2.ts'), 'utf8');

describe('public repository registry identity foreign-key safety', () => {
  it('uses the persisted identity id returned by the canonical-key upsert', () => {
    const s = source();
    const start = s.indexOf('async function recordRegistryReality');
    const end = s.indexOf('async function upsert', start);
    const branch = s.slice(start, end);

    expect(branch).toContain('ON CONFLICT (provider,canonical_key) DO UPDATE');
    expect(branch).toContain('RETURNING id');
    expect(branch).toContain("const iid=String(identityRow.rows[0]?.id??'')");
    expect(branch).toContain("if(!iid)throw new Error('REGISTRY_IDENTITY_UPSERT_RETURNED_NO_ID')");
  });

  it('writes the observation with the returned id, not the proposed deterministic id', () => {
    const s = source();
    const start = s.indexOf('async function recordRegistryReality');
    const end = s.indexOf('async function upsert', start);
    const branch = s.slice(start, end);

    expect(branch).toContain('const proposedId=identityId(c)');
    expect(branch).toContain('[oid,iid,c.url');
    expect(branch).not.toContain('[oid,proposedId,c.url');
    expect(branch).toContain('return iid;');
  });
});
