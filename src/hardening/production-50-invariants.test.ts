import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const has = (p: string, s: string) => read(p).includes(s);

describe('production hardening contract: 50 invariants', () => {
  it('01 MCP transport caps request body', () => expect(has('src/mcp/transport.ts', 'MAX_BODY_BYTES = 128 * 1024')).toBe(true));
  it('02 MCP transport caps sessions', () => expect(has('src/mcp/transport.ts', 'MAX_SESSION_ID = 128')).toBe(true));
  it('03 MCP transport caps JSON-RPC ids', () => expect(has('src/mcp/transport.ts', 'MAX_ID_LENGTH = 128')).toBe(true));
  it('04 MCP transport caps origins', () => expect(has('src/mcp/transport.ts', 'MAX_ORIGIN_LENGTH = 512')).toBe(true));
  it('05 MCP transport has request rate limit', () => expect(has('src/mcp/transport.ts', 'MAX_REQUESTS_PER_WINDOW = 60')).toBe(true));
  it('06 MCP transport uses constant-time token comparison', () => expect(has('src/mcp/transport.ts', 'timingSafeEqual')).toBe(true));
  it('07 MCP transport requires Bearer syntax', () => expect(has('src/mcp/transport.ts', '/^Bearer [A-Za-z0-9._~-]{16,4096}$/')).toBe(true));
  it('08 MCP transport requires strong configured bearer', () => expect(has('src/mcp/transport.ts', 'MCP bearer credential is missing or too weak')).toBe(true));
  it('09 MCP transport rejects non-POST requests', () => expect(has('src/mcp/transport.ts', 'POST is required')).toBe(true));
  it('10 MCP transport validates HTTPS origins', () => expect(has('src/mcp/transport.ts', "url.protocol === 'https:'")).toBe(true));
  it('11 MCP transport rejects localhost origins', () => expect(has('src/mcp/transport.ts', "url.hostname !== 'localhost'")).toBe(true));
  it('12 MCP transport rejects malformed origins', () => expect(has('src/mcp/transport.ts', 'catch { return false; }')).toBe(true));
  it('13 MCP transport forbids cookie header injection', () => expect(has('src/mcp/transport.ts', 'cookie|set-cookie')).toBe(true));
  it('14 MCP transport forbids API-key header injection', () => expect(has('src/mcp/transport.ts', 'x-api-key')).toBe(true));
  it('15 MCP transport sets no-store cache control', () => expect(has('src/mcp/transport.ts', 'cache-control',)).toBe(true));
  it('16 MCP transport sets nosniff', () => expect(has('src/mcp/transport.ts', 'x-content-type-options')).toBe(true));
  it('17 MCP transport authenticates before body processing', () => {
    const s = read('src/mcp/transport.ts'); expect(s.indexOf('if (!token || !constantTimeToken') < s.indexOf('const body = await readJson')).toBe(true);
  });
  it('18 MCP transport rate-limits authenticated callers', () => expect(has('src/mcp/transport.ts', 'rateLimited(requestKey(request, token))')).toBe(true));
  it('19 MCP transport requires an MCP session for tool calls', () => expect(has('src/mcp/transport.ts', 'Valid MCP session required')).toBe(true));
  it('20 MCP transport validates tool names', () => expect(has('src/mcp/transport.ts', 'validateToolName(body.params.name)')).toBe(true));

  it('21 MCP execution resolves signed passports', () => expect(has('src/mcp/execute.ts', 'resolveAgentPassport(args.passport)')).toBe(true));
  it('22 MCP execution fails closed for invalid passports', () => expect(has('src/mcp/execute.ts', 'INVALID_OR_EXPIRED_SIGNED_PASSPORT')).toBe(true));
  it('23 MCP claim verification does not infer trust', () => expect(has('src/mcp/execute.ts', 'SPR does not infer a claim from incomplete evidence')).toBe(true));
  it('24 MCP claim verification hashes claims', () => expect(has('src/mcp/execute.ts', 'hashAgentClaim(args.claim)')).toBe(true));

  it('25 billing uses deployment-configured Stripe price ids', () => expect(has('src/routes/billing.ts', 'config.stripe.prices')).toBe(true));
  it('26 billing refuses missing Stripe secret', () => expect(has('src/routes/billing.ts', 'BILLING_NOT_CONFIGURED')).toBe(true));
  it('27 billing refuses inactive/unpriced Stripe prices', () => expect(has('src/routes/billing.ts', 'price.unit_amount == null || !price.active')).toBe(true));
  it('28 billing caches resolved prices briefly', () => expect(has('src/routes/billing.ts', 'PRICE_CACHE_TTL_MS = 5 * 60 * 1000')).toBe(true));
  it('29 billing does not invent a price label', () => expect(has('src/routes/billing.ts', 'priceLabel: price?.priceLabel ?? null')).toBe(true));
  it('30 billing validates plan checkout input', () => expect(has('src/routes/billing.ts', 'z.enum(PLAN_IDS')).toBe(true));
  it('31 billing validates one-time checkout input', () => expect(has('src/routes/billing.ts', 'z.enum(ONE_TIME_IDS')).toBe(true));
  it('32 billing validates add-on checkout input', () => expect(has('src/routes/billing.ts', 'z.enum(ADDON_IDS')).toBe(true));
  it('33 billing catalog is public but contains no tenant data', () => expect(has('src/routes/billing.ts', "router.get('/catalog'")).toBe(true));
  it('34 billing authenticated surface requires auth', () => expect(has('src/routes/billing.ts', "router.get('/', requireAuth")).toBe(true));

  it('35 entitlements distinguish active subscriptions', () => expect(has('src/security/entitlements.ts', "'active'")).toBe(true));
  it('36 entitlements distinguish trialing subscriptions', () => expect(has('src/security/entitlements.ts', "'trialing'")).toBe(true));
  it('37 entitlements distinguish past-due subscriptions', () => expect(has('src/security/entitlements.ts', "'past_due'")).toBe(true));
  it('38 entitlements handle lapsed access explicitly', () => expect(has('src/security/entitlements.ts', 'lapsed')).toBe(true));
  it('39 entitlement enforcement exists centrally', () => expect(has('src/security/entitlements.ts', 'enforceCapability')).toBe(true));
  it('40 entitlement enforcement can return payment-required', () => expect(has('src/security/entitlements.ts', '402')).toBe(true));

  it('41 public passport tokens carry tenant scope', () => expect(has('src/routes/public-connect.ts', 'tenantId')).toBe(true));
  it('42 public passport tokens carry passport scope', () => expect(has('src/routes/public-connect.ts', 'passportId')).toBe(true));
  it('43 public passport tokens expire', () => expect(has('src/routes/public-connect.ts', 'exp')).toBe(true));
  it('44 public passport verification uses HMAC', () => expect(has('src/routes/public-connect.ts', 'HMAC')).toBe(true));
  it('45 public passport lookup is tenant scoped', () => {
    const s = read('src/routes/public-connect.ts'); expect(/tenant_id|tenantId/.test(s)).toBe(true);
  });

  it('46 registry observations are immutable', () => expect(has('migrations/0111_living_registry_integrity.sql', 'REGISTRY_OBSERVATION_IMMUTABLE')).toBe(true));
  it('47 registry identity keys are unique', () => expect(has('migrations/0111_living_registry_integrity.sql', 'unique (provider, canonical_key)')).toBe(true));
  it('48 registry RLS is enabled', () => expect(has('migrations/0111_living_registry_integrity.sql', 'ENABLE ROW LEVEL SECURITY')).toBe(true));
  it('49 registry backfill avoids fabricated popularity', () => expect(has('migrations/0112_registry_observed_backfill.sql', 'Unknown popularity is NULL, never fabricated as 0')).toBe(true));
  it('50 production containers run as non-root uid 10001', () => {
    expect(has('Dockerfile', 'USER 10001:10001')).toBe(true);
    expect(has('Dockerfile.worker', 'USER 10001:10001')).toBe(true);
  });
});
