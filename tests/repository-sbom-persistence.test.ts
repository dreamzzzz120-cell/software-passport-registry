import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('repository SBOM persistence contract', () => {
  it('persists all normalized components while OSV receives only versioned components', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/workers/osv-worker.ts'), 'utf8');
    expect(source).toContain('const sbom = generated.document; const components = generated.components; const osvComponents = components.filter(component => component.version);');
    expect(source).toContain("JSON.stringify(components)])");
    expect(source).not.toContain("JSON.stringify(osvComponents)])");
  });
});
