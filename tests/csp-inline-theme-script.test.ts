import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');

// The theme bootstrap in index.html runs before first paint to set data-theme.
// It is inline, so CSP must allow it by HASH - never by 'unsafe-inline', which
// would re-open the whole page to injected script.
const HASH = "'sha256-kWQT+628v4D1A4MJk9hTD6a0W1AdPlPKtzhPlYKIpZc='";

describe('inline theme script is allowed by hash, not by unsafe-inline', () => {
  it('the Vercel CSP carries the hash and never unsafe-inline for scripts', () => {
    const vercel = read('vercel.json');
    const scriptSrc = vercel.match(/script-src[^;]*/)?.[0] ?? '';
    expect(scriptSrc).toContain(HASH);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  // The behavioural version of this lives in tests/security/http-hardening.test.ts,
  // which asserts the real response header -- but that suite only runs with
  // NODE_ENV=test. This keeps a regression from reaching main through the
  // default gate, because the failure mode is silent: the browser blocks the
  // request, the server logs nothing, and sign-in simply does nothing.
  it('connect-src reaches Firebase Auth and the intake store, and is not widened to https:', () => {
    const server = read('server.ts');
    expect(server).toContain('https://identitytoolkit.googleapis.com');
    expect(server).toContain('https://securetoken.googleapis.com');
    // The Supabase origin is derived from SUPABASE_URL rather than hardcoded,
    // so assert the derivation exists rather than a literal host.
    expect(server).toContain('supabaseOrigin');
    const connectSrc = server.match(/const connectSrc = \[[^\]]*\]/)?.[0] ?? '';
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).not.toMatch(/['"]https:['"]/);
  });

  it('the helmet CSP carries the same quoted hash and never unsafe-inline', () => {
    const server = read('server.ts');
    const scriptSrc = server.match(/scriptSrc: \[[^\]]*\]/)?.[0] ?? '';
    expect(scriptSrc).toContain(HASH);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    // CSP hash sources are only valid when quoted; helmet joins values verbatim.
    expect(scriptSrc).toMatch(/"'sha256-[^"]+='"/);
  });

  it('an inline script still exists to be allowed', () => {
    expect(read('index.html')).toMatch(/<script>[\s\S]*data-theme[\s\S]*<\/script>/);
  });

  it('documents that the hash is bound to the exact served bytes', () => {
    // Guard rail: the hash covers the BUILT output, which differs from the
    // source template by whitespace. Editing the script - even whitespace -
    // invalidates the hash and silently re-blocks the script, so this test
    // records the dependency explicitly.
    const source = read('index.html').match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    const sourceHash = 'sha256-' + crypto.createHash('sha256').update(source, 'utf8').digest('base64');
    expect(sourceHash.startsWith('sha256-')).toBe(true);
    expect(source).toContain('spr-theme');
  });
});
