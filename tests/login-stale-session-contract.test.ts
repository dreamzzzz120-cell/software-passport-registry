import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('login stale-session recovery', () => {
  it('clears only stale local Supabase session state before a fresh password login', () => {
    const source = fs.readFileSync(path.join(root, 'src/components/LoginView.tsx'), 'utf8');
    expect(source).toContain("code.includes('session_not_found')");
    expect(source).toContain("supabase.auth.signOut({ scope: 'local' })");
    expect(source).toContain('supabase.auth.signInWithPassword');
    expect(source).toContain('Your previous session had expired. Sign in again to continue.');
  });
});
