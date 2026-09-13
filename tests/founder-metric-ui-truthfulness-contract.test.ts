import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Founder metric UI truthfulness contracts', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/FounderCommandCenterPanel.tsx'), 'utf8');

  it('models platform counts as nullable', () => {
    expect(source).toContain('organizationCount: number | null');
    expect(source).toContain('userCount: number | null');
    expect(source).toContain('mrrCents: number | null');
  });

  it('renders unavailable values as Not verified instead of String(null)', () => {
    expect(source).toContain("function observedCount(value: number | null) {");
    expect(source).toContain("return value === null ? 'Not verified' : String(value);");
    expect(source).toContain("function money(cents: number | null) {");
    expect(source).toContain("return cents === null ? 'Not verified'");
  });

  it('does not label the customer registry as all tenants', () => {
    expect(source).toContain('Customer Passport Registry');
    expect(source).not.toContain('Passport Registry — All Tenants');
  });
});
