import { describe, expect, it } from 'vitest';
import { evaluateReadiness, sanitizeReadiness } from './health-contract';

describe('production readiness contract', () => {
  it('is ready only when every required dependency is healthy', () => {
    expect(evaluateReadiness([{ name: 'db', ok: true }, { name: 'redis', ok: true }]).ready).toBe(true);
    expect(evaluateReadiness([{ name: 'db', ok: false }, { name: 'redis', ok: true }]).ready).toBe(false);
  });

  it('does not expose dependency details through the sanitized readiness response', () => {
    expect(sanitizeReadiness([{ name: 'db', ok: false, detail: 'password=secret' }])).toEqual([{ name: 'db', ok: false }]);
  });
});
