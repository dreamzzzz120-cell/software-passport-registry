import { describe, expect, it } from 'vitest';
import { databaseErrorCode } from '../src/security/database-error-code';
import { readRaw } from './helpers/source-contract';

describe('session persistence error diagnostics', () => {
  it('returns SQLSTATE without SQL, identity, IP, or user-agent values', () => {
    const error = Object.assign(new Error('failed SQL with private user-id and IP'), {
      cause: Object.assign(new Error('private session and user agent'), { code: '23503' }),
    });
    expect(databaseErrorCode(error)).toBe('23503');
    expect(databaseErrorCode({ code: '08006' })).toBe('08006');
  });
  it.each([null, 'private session', { code: 'SQL WITH SECRET' }, { cause: { code: '23503\nsecret' } }, { code: 23503 }])('fails closed for malformed diagnostic data %j', error => {
    expect(databaseErrorCode(error)).toBe('UNKNOWN');
  });
  it('uses only the sanitized database code when optional session persistence fails', () => {
    const source = readRaw('src/middleware/security.ts');
    const start = source.indexOf('void recordSessionDetached');
    const failure = source.slice(start, source.indexOf('return next();', start));
    expect(failure).toContain('databaseErrorCode(err)');
    expect(failure).not.toContain('err.message');
    expect(failure).not.toContain('causeMessage');
  });
});
