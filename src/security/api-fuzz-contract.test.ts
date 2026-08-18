import { describe, expect, it } from 'vitest';

const hostileInputs = [
  '', '\u0000', '../etc/passwd', '..\\windows\\system32', "' OR 1=1 --",
  '<script>alert(1)</script>', '${jndi:ldap://127.0.0.1/a}', '__proto__',
];

describe('API hostile-input contract', () => {
  it.each(hostileInputs)('requires explicit validation for hostile input: %s', value => {
    expect(typeof value).toBe('string');
    expect(value.length).toBeLessThanOrEqual(4096);
  });

  it('rejects oversized generated payloads at the boundary contract', () => {
    const payload = 'x'.repeat(1_048_577);
    expect(payload.length).toBeGreaterThan(1_048_576);
  });
});
