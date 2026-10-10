import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('self-service signup without email confirmation', () => {
  it('creates new Supabase users as already confirmed on the server', async () => {
    const source = await readFile(path.resolve('src/routes/auth.ts'), 'utf8');
    expect(source).toContain("router.post('/auth/signup'");
    expect(source).toContain('emailVerified: true');
    expect(source).toContain('adminAuth.createUser');
  });

  it('signs in immediately after account creation instead of waiting for confirmation email', async () => {
    const source = await readFile(path.resolve('src/components/LoginView.tsx'), 'utf8');
    expect(source).toContain("fetch('/api/auth/signup'");
    expect(source).toContain('supabase.auth.signInWithPassword');
    expect(source).not.toContain('Supabase has sent a confirmation link');
  });
});
