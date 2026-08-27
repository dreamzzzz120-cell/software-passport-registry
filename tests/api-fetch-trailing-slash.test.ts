import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const componentsDir = path.join(root, 'src', 'components');

// Real production regression: apiFetch('/api/integrations-live/') (trailing
// slash) silently returned the SPA shell in production instead of proxying
// to Railway, because vercel.json's `/api/:path*` rewrite does not match a
// trailing slash and falls through to the catch-all `/(.*) -> /index.html`
// rule. response.ok was true (200) and response.json() failed on HTML, so
// the try/catch around it hid the failure completely -- the Integrations
// page just rendered an empty connector grid with no error. Guard against
// reintroducing this exact class of bug anywhere else in the frontend.
describe('apiFetch calls never use a bare trailing-slash path', () => {
  const files = fs.readdirSync(componentsDir).filter((file) => file.endsWith('.tsx'));

  it('found component files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} does not call apiFetch with a trailing-slash literal path`, () => {
      const content = fs.readFileSync(path.join(componentsDir, file), 'utf8');
      const offenders = content.match(/apiFetch\(['"`]\/api\/[^'"`]*\/['"`]\)/g) ?? [];
      expect(offenders).toEqual([]);
    });
  }
});
