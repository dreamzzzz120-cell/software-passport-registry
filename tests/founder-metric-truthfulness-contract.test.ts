import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Founder metric truthfulness contracts', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/routes/founder-command-center.ts'), 'utf8');

  it('does not default failed organization/user queries to zero', () => {
    expect(source).toContain('let organizationCount: number | null = null;');
    expect(source).toContain('let userCount: number | null = null;');
    expect(source).not.toContain('let organizationCount = 0;');
    expect(source).not.toContain('let userCount = 0;');
  });

  it('only publishes counts after a value was actually observed', () => {
    expect(source).toContain('if (rawCount !== undefined && rawCount !== null) organizationCount = Number(rawCount);');
    expect(source).toContain('if (rawCount !== undefined && rawCount !== null) userCount = Number(rawCount);');
  });
});
