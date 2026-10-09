import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Free Review capability URL response controls', () => {
  it('marks token-bearing result pages noncacheable, private and nonindexable at the edge', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    const rule = config.headers.find((rule: { source: string }) => rule.source === '/free-review/result/(.*)');
    expect(rule).toBeDefined();
    const headers = Object.fromEntries(rule.headers.map((header: { key: string; value: string }) => [header.key.toLowerCase(), header.value]));
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['cache-control']).toContain('private');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-robots-tag']).toContain('noindex');
  });
});
