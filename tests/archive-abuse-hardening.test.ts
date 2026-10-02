import { describe, expect, it } from 'vitest';
import { validateArchiveEntries } from '../src/workers/osv-worker.ts';

describe('archive entry path hardening', () => {
  it('accepts ordinary relative archive members', () => {
    expect(() => validateArchiveEntries([
      'repo/package.json',
      'repo/src/index.ts',
      'repo/docs/security/readme.md',
    ])).not.toThrow();
  });

  it.each([
    ['../escape.txt'],
    ['repo/../../escape.txt'],
    ['/etc/passwd'],
    ['C:/Windows/System32/config'],
    ['C:\\Windows\\System32\\config'],
  ])('rejects archive path escape %j', (entries) => {
    expect(() => validateArchiveEntries([entries])).toThrow(/REPOSITORY_PATH_INVALID/);
  });

  it('rejects an archive whose member count exceeds the configured hard ceiling', () => {
    const entries = Array.from({ length: 250_001 }, (_, i) => `repo/file-${i}.txt`);
    expect(() => validateArchiveEntries(entries)).toThrow(/REPOSITORY_FILE_LIMIT_EXCEEDED/);
  });
});
