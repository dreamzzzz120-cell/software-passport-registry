import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('production security invariant contract', () => {
  const workflow = fs.readFileSync('.github/workflows/security-invariants.yml', 'utf8');
  const docker = fs.readFileSync('Dockerfile', 'utf8');
  const workerDocker = fs.readFileSync('Dockerfile.worker', 'utf8');
  const vercel = fs.readFileSync('vercel.json', 'utf8');

  it('keeps the security workflow read-only and credential-free', () => {
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('npm ci --ignore-scripts');
    expect(workflow).toContain('npm run verify:actions');
  });

  it('requires dependency and application verification', () => {
    for (const marker of [
      'npm audit --omit=dev --audit-level=high',
      'npm run typecheck',
      'npm test -- --reporter=dot',
      'npm run build',
    ]) expect(workflow).toContain(marker);
  });

  it('requires non-root production containers', () => {
    expect(docker).toContain('ENV NODE_ENV=production');
    expect(docker).toContain('USER 10001:10001');
    expect(workerDocker).toContain('ENV NODE_ENV=production');
    expect(workerDocker).toContain('USER 10001:10001');
  });

  it('keeps worker browser configuration non-production', () => {
    expect(workerDocker).toContain('worker-build.invalid');
    expect(workerDocker).toContain('worker-build-placeholder');
  });

  it('requires private-route crawler protection', () => {
    expect(vercel).toContain('X-Robots-Tag');
    expect(vercel).toContain('noindex, nofollow, noarchive');
  });

  it('requires core browser security headers', () => {
    for (const marker of [
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Content-Security-Policy',
    ]) expect(vercel).toContain(marker);
  });
});
