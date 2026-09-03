import { describe, expect, it } from 'vitest';
import { validateFilePolicy } from '../src/routes/universal-intake.ts';

// Live bug: a real .ts upload was rejected with "File content type is not
// supported for SPR intake." even though .ts is an allowed extension. The
// browser reported a MIME type (video/mp2t is a well-known misdetection for
// .ts files) that wasn't in the old single MIME allowlist shared by every
// extension. Source/config files have no standardized MIME type across
// browsers/OSes, so they must not be rejected on that basis -- only the
// extension allowlist and document/archive MIME checks are meaningful gates.
describe('universal intake file policy', () => {
  const base = { name: 'component.ts', size: 1024, contentType: '', kind: 'unknown' as const };

  it('accepts a .ts file regardless of the (unstandardized, often wrong) browser-reported MIME type', () => {
    expect(validateFilePolicy({ ...base, contentType: 'video/mp2t' })).toBeNull();
    expect(validateFilePolicy({ ...base, contentType: 'text/typescript' })).toBeNull();
    expect(validateFilePolicy({ ...base, contentType: '' })).toBeNull();
  });

  it('accepts every other source/config extension with an arbitrary or blank content type', () => {
    for (const name of ['package.json', 'requirements.py', 'main.go', 'lib.rs', 'app.rb', 'index.php', 'config.toml', 'values.yaml', 'notes.md']) {
      expect(validateFilePolicy({ ...base, name, contentType: '' })).toBeNull();
      expect(validateFilePolicy({ ...base, name, contentType: 'application/octet-stream' })).toBeNull();
    }
  });

  it('still enforces a real MIME check for document/archive extensions', () => {
    expect(validateFilePolicy({ ...base, name: 'report.pdf', contentType: 'application/pdf' })).toBeNull();
    expect(validateFilePolicy({ ...base, name: 'report.pdf', contentType: 'application/x-msdownload' })).toMatch(/content type/i);
    expect(validateFilePolicy({ ...base, name: 'bundle.zip', contentType: 'application/zip' })).toBeNull();
    expect(validateFilePolicy({ ...base, name: 'bundle.zip', contentType: 'application/x-msdownload' })).toMatch(/content type/i);
  });

  it('still rejects an unsupported extension outright', () => {
    expect(validateFilePolicy({ ...base, name: 'binary.exe', contentType: '' })).toMatch(/file type/i);
  });
});
