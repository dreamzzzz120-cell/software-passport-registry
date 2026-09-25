import { describe, expect, it } from 'vitest';
import { treeHasSupportedManifest } from '../src/agents/public-repository-team-v2.ts';

describe('autonomous registry manifest preflight', () => {
  it('accepts supported manifests in nested projects', () => {
    expect(treeHasSupportedManifest([{ path: 'apps/web/package.json', type: 'blob' }])).toBe(true);
    expect(treeHasSupportedManifest([{ path: 'src/App/App.csproj', type: 'blob' }])).toBe(true);
  });

  it('rejects a repository with no supported dependency manifest', () => {
    expect(treeHasSupportedManifest([
      { path: 'README.md', type: 'blob' },
      { path: 'docs/package.json', type: 'tree' },
    ])).toBe(false);
  });
});
