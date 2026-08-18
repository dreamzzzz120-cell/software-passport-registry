import { describe, expect, it } from 'vitest';
import { requireRole } from '../middleware/security.ts';

describe('authorization regression guards', () => {
  const invoke = (role: string | undefined, allowed: string | string[]) => {
    let status = 200;
    let body: unknown;
    let called = false;
    const req: any = { user: role ? { role } : undefined };
    const res: any = { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; } };
    requireRole(allowed)(req, res, () => { called = true; });
    return { status, body, called };
  };

  it.each([
    ['Owner', ['Owner', 'Admin']],
    ['Admin', ['Owner', 'Admin']],
    ['Technician', ['Technician']],
  ])('allows explicitly permitted role %s', (role, allowed) => {
    expect(invoke(role, allowed).called).toBe(true);
  });

  it.each(['Technician', 'User', 'Viewer', 'Guest', 'unknown'])('denies unprivileged role %s from Owner/Admin operations', role => {
    const result = invoke(role, ['Owner', 'Admin']);
    expect(result.status).toBe(403);
    expect(result.called).toBe(false);
  });

  it('denies requests with no authenticated user', () => {
    const result = invoke(undefined, ['Admin']);
    expect(result.status).toBe(401);
    expect(result.called).toBe(false);
  });
});
