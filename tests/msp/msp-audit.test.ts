import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// SECTION 20 of the MSP acceptance spec. audit_trail is a real, hash-chained
// table (see /auth/audit-chain and /auth/audit-chain/verify in auth.ts,
// verifyAuditChain) -- this checks which of the spec's required event
// categories actually write to it today, by scanning every appendAuditEntry
// call in src/ for its action string.
const srcFiles: string[] = [];
(function walk(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts')) srcFiles.push(full);
  }
})(path.join(process.cwd(), 'src'));

const allActions = new Set<string>();
for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/action:\s*'([a-z0-9._]+)'/g)) allActions.add(match[1]);
}

function hasActionPrefix(prefix: string): boolean {
  return [...allActions].some((action) => action.startsWith(prefix));
}

describe('audit coverage for the event categories section 20 requires', () => {
  it('login is tracked (via user_sessions / login-history, not the audit_trail hash chain, and that is a legitimate split)', () => {
    const security = fs.readFileSync(path.join(process.cwd(), 'src/security/session-tracking.ts'), 'utf8');
    expect(security).toContain('INSERT INTO user_sessions');
  });

  it('workspace/account creation is audited', () => {
    expect(hasActionPrefix('workspace.created')).toBe(true);
  });

  it('role changes are audited', () => {
    expect(hasActionPrefix('team.role_changed')).toBe(true);
  });

  it('client creation is audited', () => {
    expect(hasActionPrefix('client.created')).toBe(true);
  });

  it('billing events are audited', () => {
    expect(hasActionPrefix('billing.')).toBe(true);
  });

  it('administrative actions (retention policy, branding, tenant deletion requests) are audited', () => {
    expect(hasActionPrefix('retention.')).toBe(true);
    expect(hasActionPrefix('branding.')).toBe(true);
    expect(hasActionPrefix('tenant.deletion')).toBe(true);
  });

  it('scan execution is audited', () => {
    expect(hasActionPrefix('scan.queued')).toBe(true);
  });

  it('evidence creation is audited', () => {
    expect(hasActionPrefix('evidence.created')).toBe(true);
  });

  it('Passport publication is audited', () => {
    expect(hasActionPrefix('passport.published')).toBe(true);
  });
});
