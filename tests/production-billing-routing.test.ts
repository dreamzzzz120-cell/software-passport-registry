import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('production billing routing', () => {
  it('keeps billing on the same Railway backend as the rest of the API', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    const billing = config.rewrites.find((route) => route.source === '/api/billing/:path*');
    const api = config.rewrites.find((route) => route.source === '/api/:path*');

    expect(billing).toBeDefined();
    expect(api).toBeDefined();
    expect(new URL(billing!.destination).host).toBe(new URL(api!.destination).host);
  });
});
