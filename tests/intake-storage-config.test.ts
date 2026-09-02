import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');

// Production had SUPABASE_SECRET_KEY while this route read only
// SUPABASE_SERVICE_ROLE_KEY, so /api/intake/upload-url answered 503 for every
// visitor: the homepage's headline feature accepted staged files and then failed
// hard. The names diverge because Supabase renamed the server-side key, so the
// route has to accept both vintages.
describe('universal intake storage configuration', () => {
  const route = read('src/routes/universal-intake.ts');

  it('accepts either the current or the legacy Supabase server key name', () => {
    expect(route).toContain('SUPABASE_SECRET_KEY');
    expect(route).toContain('SUPABASE_SERVICE_ROLE_KEY');
    // Both must feed the same value, not two independent lookups.
    expect(route).toMatch(/SUPABASE_SECRET_KEY[^\n]*\|\|[^\n]*SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('names the missing variable instead of failing opaquely', () => {
    // The original message said only "storage is not configured", which is how a
    // variable-name mismatch survived a production deploy unnoticed.
    expect(route).toContain('is not set');
    expect(route).toMatch(/missing/i);
  });

  // .dockerignore excludes .env.* so no environment file can ever be copied into
  // an image. That is a security control and it stays -- punching a hole in it to
  // satisfy a test would be exactly backwards. This documentation check is a
  // repository contract, not an image one, and .env.example is legitimately absent
  // inside the Docker build (which is where it failed: ENOENT /app/.env.example).
  // It therefore skips only in that context, and the rule that justifies the skip
  // is itself asserted below, so the skip cannot quietly become a hole if
  // .dockerignore ever changes.
  const inRepoCheckout = fs.existsSync(path.join(root, '.env.example'));

  it.skipIf(!inRepoCheckout)('documents the variables it requires', () => {
    const example = read('.env.example');
    expect(example).toContain('SUPABASE_URL');
    expect(example).toContain('SUPABASE_SECRET_KEY');
  });

  it('keeps environment files out of the image, which is what lets the check above skip', () => {
    const dockerignore = read('.dockerignore');
    expect(dockerignore).toMatch(/^\.env$/m);
    expect(dockerignore).toMatch(/^\.env\.\*$/m);
  });

  it('still refuses to serve uploads when storage is unconfigured', () => {
    // Fail closed: no silent fallback to a public bucket or a local path.
    expect(route).toContain('status: 503');
    expect(route).not.toMatch(/publicUrl|anon[_ ]?key/i);
  });
});
