import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

describe('public registry routing contract', () => {
  it('keeps /registry public for signed-out visitors', () => {
    expect(app).toContain("'/registry'");
    expect(app).toContain("if (!user && path === '/registry') return <PublicRegistryView />;");
  });

  it('keeps /registry available inside the authenticated app shell', () => {
    expect(app).toContain("case '/registry': view = <PublicRegistryView />; break;");
    expect(app).toContain("path === '/passports' || path === '/registry' ? 'passports'");
  });

  it('does not directly redirect registry visitors to billing', () => {
    expect(app).not.toMatch(/path === ['"]\/registry['"][^\n]*billing/i);
  });
});
