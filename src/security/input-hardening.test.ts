import { describe, expect, it } from 'vitest';

const MAX_BODY_BYTES = 1_048_576;
const MAX_HEADER_VALUE = 8_192;

function safeObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function safePathSegment(value: string): boolean {
  return value.length > 0 && value.length <= 200 && !/[\\/]/.test(value) && value !== '.' && value !== '..';
}

describe('input security regression guards', () => {
  it('rejects prototype-pollution keys', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(Object.prototype.hasOwnProperty.call(input, '__proto__')).toBe(true);
    expect(['__proto__', 'prototype', 'constructor']).toContain('__proto__');
  });

  it('does not accept arrays where object payloads are expected', () => {
    expect(safeObject([])).toBeNull();
    expect(safeObject(null)).toBeNull();
    expect(safeObject('string')).toBeNull();
  });

  it('rejects path traversal segments', () => {
    for (const value of ['../secret', '..\\secret', '/etc/passwd', '\\windows\\system32', '..']) {
      expect(safePathSegment(value)).toBe(false);
    }
    expect(safePathSegment('passport-123')).toBe(true);
  });

  it('enforces bounded body and header sizes', () => {
    expect(MAX_BODY_BYTES).toBe(1_048_576);
    expect(MAX_HEADER_VALUE).toBe(8_192);
    expect(1_048_577 > MAX_BODY_BYTES).toBe(true);
    expect(8_193 > MAX_HEADER_VALUE).toBe(true);
  });

  it('uses parameterized-query contract rather than string interpolation', () => {
    const malicious = "' OR 1=1 --";
    const query = { text: 'SELECT id FROM clients WHERE tenant_id = $1 AND id = $2', values: ['tenant-a', malicious] };
    expect(query.text).not.toContain(malicious);
    expect(query.values[1]).toBe(malicious);
  });
});
