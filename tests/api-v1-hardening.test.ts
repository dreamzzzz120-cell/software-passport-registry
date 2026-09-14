import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(resolve(process.cwd(), 'src/routes/public-api-v1.ts'), 'utf8');
const agentRoute = readFileSync(resolve(process.cwd(), 'src/routes/agent-api.ts'), 'utf8');
const migration = readFileSync(resolve(process.cwd(), 'migrations/0096_public_api_v1.sql'), 'utf8');

describe('public API v1 hardening invariants', () => {
  it('uses high-entropy live API keys with an exact accepted shape', () => {
    expect(route).toContain("randomBytes(32).toString('base64url')");
    expect(route).toContain("`spr_live_${randomBytes(32).toString('base64url')}`");
    expect(route).toContain('/^spr_live_[A-Za-z0-9_-]{43}$/');
  });
  it('stores only the API-key hash and returns the raw secret only at creation', () => {
    expect(route).toContain("createHash('sha256')");
    expect(route).toContain('key_hash');
    expect(route).toContain('apiKey: secret');
    expect(route).not.toContain('apiKey: hashKey(secret)');
  });
  it('requires write scope for registration and read scope for verification surfaces', () => {
    expect(route).toContain("publicApi.post('/passports', scope('write')");
    expect(route).toContain("publicApi.post('/passports/verify', scope('read')");
    expect(route).toContain("publicApi.get('/passports/:passportId/evidence', scope('read')");
    expect(route).toContain("publicApi.get('/passports/:passportId/freshness', scope('read')");
  });
  it('keeps passport identity uniqueness tenant-scoped', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS passports_api_identity_unique');
    expect(migration).toContain('ON passports (tenant_id, lower(name), version, lower(file_hash))');
  });
  it('checks client ownership inside the authenticated tenant before linking it', () => {
    expect(route).toContain('SELECT id FROM clients WHERE tenant_id=${req.user!.tenantId} AND id=${p.clientId}');
  });
  it('does not turn missing evidence into an approval claim', () => {
    expect(route).toContain("trustStatus: 'UNKNOWN'");
    expect(route).toContain("status: 'UNKNOWN'");
    expect(route).toContain('does not manufacture or duplicate trust decisions');
  });
  it('does not expose API-key hashes or raw secrets through the list endpoint', () => {
    expect(route).toContain('key_prefix AS "keyPrefix"');
    expect(route).not.toContain('SELECT id,name,key_hash');
    expect(route).not.toContain('SELECT id,name,secret');
  });
  it('keeps revocation tenant-scoped and idempotent', () => {
    expect(route).toContain('WHERE id=${req.params.keyId} AND tenant_id=${req.user!.tenantId} AND revoked_at IS NULL');
    expect(route).toContain('COALESCE(revoked_at,CURRENT_TIMESTAMP::text)');
  });
  it('preserves the existing Experience Agent implementation separately', () => {
    expect(agentRoute).toContain("router.post('/command'");
    expect(agentRoute).toContain('spr-experience-agent-v1');
  });
});
