import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public product docs contract', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const docs = fs.readFileSync('src/components/PublicDocsView.tsx', 'utf8');
  const footer = fs.readFileSync('src/components/legal/LegalFooterLinks.tsx', 'utf8');

  it('makes /docs/ public and routable without authentication', () => {
    expect(app).toContain("'/docs/'");
    expect(app).toContain("if (path === '/docs/') return <PublicDocsView");
  });

  it('documents evidence semantics without converting UNKNOWN into a pass', () => {
    expect(docs).toContain('UNKNOWN is not a pass');
    expect(docs).toContain('Claim → Evidence → Source → Timestamp → Hash → History');
    expect(docs).toContain('A failed collector or provider call must not be interpreted as a clean result.');
  });

  it('links the documentation from the public footer', () => {
    expect(footer).toContain('href="/docs/"');
  });
});
