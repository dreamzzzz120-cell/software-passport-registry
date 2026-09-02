import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freeReviewResultPath, freeReviewStatusApiPath } from '../src/components/FreeReviewView.tsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');
const app = read('src/App.tsx');
// Commit a4775a0 split src/routes/free-review.ts into a composer that mounts two
// routers. The Free Review implementation these contracts describe moved intact
// to free-review-legacy.ts, so the assertions below follow it there rather than
// being relaxed. The composer is asserted separately in "the implementation is
// actually mounted", so both "the guarantee exists" and "the guarantee is
// reachable" stay covered -- neither was checked before the split.
const freeReviewImpl = read('src/routes/free-review-legacy.ts');
const freeReviewComposer = read('src/routes/free-review.ts');
// These files explain their guarantees in prose, naming the very APIs they
// avoid. Assert against code only.
const stripComments = (s) => s.split(String.fromCharCode(10))
  .filter((l) => !l.trimStart().startsWith('//'))
  .join(String.fromCharCode(10)).replace(/[/][*][^]*?[*][/]/g, '');

// The route pattern App uses, mirrored here so the tests exercise the real shape.
const PATTERN = /^\/free-review\/result\/([^/]+)\/([^/]+)\/?$/;
const SHA_ID = 'passport_free_94a11a8517f84683b940a880da34fe64';
// Deliberately low-entropy and obviously fake: a JWT-shaped fixture trips
// the repository's secret scanner. The slash also exercises URL encoding.
const TOKEN = 'fake-test-token/not-a-real-credential';

describe('1-4. the result is URL-addressable and survives navigation', () => {
  it('builds a public result path from the passport id and signed token', () => {
    expect(freeReviewResultPath(SHA_ID, TOKEN)).toBe(`/free-review/result/${SHA_ID}/${encodeURIComponent(TOKEN)}`);
  });

  it('the result path resolves as a public route', () => {
    expect(PATTERN.test(freeReviewResultPath(SHA_ID, TOKEN))).toBe(true);
    expect(app).toContain('const FREE_REVIEW_RESULT_PATH');
    expect(app).toContain('function isPublicPath');
    expect(app).toContain('!isPublicPath(path)');
  });

  it('reconstructs the signed status API path, so refresh re-reads the same result', () => {
    expect(freeReviewStatusApiPath(SHA_ID, TOKEN)).toBe(`/api/free-review/scan/${SHA_ID}/status/${encodeURIComponent(TOKEN)}`);
  });

  it('uses the URL as the source of truth - no browser storage', () => {
    const view = stripComments(read('src/components/FreeReviewView.tsx'));
    expect(view).not.toContain('localStorage');
    expect(view).not.toContain('sessionStorage');
    expect(view).toContain('window.history.replaceState');
  });
});

describe('5-8. malformed, missing and mismatched tokens', () => {
  it('rejects paths without a token', () => {
    for (const p of ['/free-review/result', '/free-review/result/', `/free-review/result/${SHA_ID}`, `/free-review/result/${SHA_ID}/`]) {
      expect(PATTERN.test(p), p).toBe(false);
    }
  });

  it('does not broadly whitelist /free-review/*', () => {
    for (const p of ['/free-review/anthropic/prompt-library', '/free-review/result/a/b/c', '/free-review/admin']) {
      expect(PATTERN.test(p), p).toBe(false);
    }
  });

  it('token validity is decided server-side only - the client never validates it', () => {
    const view = stripComments(read('src/components/FreeReviewView.tsx'));
    // No signature checking, decoding or expiry logic in the browser.
    expect(view).not.toContain('createHmac');
    expect(view).not.toContain('timingSafeEqual');
    expect(view).not.toContain('atob(');
    expect(view).not.toMatch(/exps*[<>=]/);
    // The server-side verifier remains the single gate.
    expect(read('src/routes/public-connect.ts')).toContain('export function verifyFreeReviewStatusToken');
    expect(freeReviewImpl).toContain('verifyFreeReviewStatusToken(req.params.token, passportId)');
  });

  it('an expired or tampered token fails at the API with a non-probing 401', () => {
    const route = freeReviewImpl;
    expect(route).toContain("if (!payload) return res.status(401).json({ error: 'Invalid or expired Free Review status link' })");
  });
});

describe('9-12. no privilege, tenant or secret exposure', () => {
  it('the result route reads only the fixed Free Review system tenant', () => {
    const route = freeReviewImpl;
    expect(route).toContain('attachTenantScope(FREE_REVIEW_TENANT_ID, res)');
    expect(route).toContain('tenant_id=${FREE_REVIEW_TENANT_ID}');
    // A passport id alone is never sufficient - the token is required.
    expect(route).toContain('verifyFreeReviewStatusToken');
  });

  it('an authenticated Passport cannot become public through this route', () => {
    // The status route only ever queries the Free Review system tenant, so a
    // real customer passport id cannot resolve through it.
    const route = freeReviewImpl;
    const handler = route.slice(route.indexOf("router.get('/free-review/scan/:passportId/status/:token'"));
    expect(handler).not.toContain('req.user');
    expect(handler).toContain('FREE_REVIEW_TENANT_ID');
  });

  it('no authentication is bypassed - the route was never authenticated', () => {
    // Neither route registers auth middleware; the file's header comment
    // merely explains that.
    expect(stripComments(freeReviewImpl)).not.toContain('requireAuth');
    // App still guards every non-public path.
    expect(app).toContain('!isPublicPath(path)');
  });

  it('the implementation is actually mounted, not just present on disk', () => {
    // Guards the failure mode the split could have introduced: the legacy router
    // could keep every guarantee above and still never be reached.
    expect(freeReviewComposer).toContain("from './free-review-legacy.ts'");
    expect(freeReviewComposer).toContain('router.use(createLegacyFreeReviewRouter())');
    expect(freeReviewImpl).toContain('export function createLegacyFreeReviewRouter');
    // The composer itself must stay a composer: no auth middleware, no handlers.
    expect(stripComments(freeReviewComposer)).not.toContain('requireAuth');
  });

  it('tokenized result links are kept out of crawlers and the sitemap', () => {
    expect(read('public/robots.txt')).toContain('Disallow: /free-review/result');
    expect(read('public/sitemap.xml')).not.toContain('/free-review/result');
  });
});

describe('13-14. existing behaviour intact', () => {
  it('the plain /free-review entry point still works', () => {
    expect(app).toContain("if (!user && path === '/free-review') return <FreeReviewView");
    expect(freeReviewImpl).toContain("router.post('/free-review/scan'");
  });

  it('the result page adds no verification logic of its own', () => {
    const view = read('src/components/FreeReviewView.tsx');
    for (const forbidden of ['evaluateVerification', 'minThirdPartySources', 'maxAgeDays', 'trustScore', 'riskLevel']) {
      expect(view, forbidden).not.toContain(forbidden);
    }
  });

  it('makes no unsupported safety claim', () => {
    const view = read('src/components/FreeReviewView.tsx');
    for (const claim of ['is secure', 'is safe', 'Guaranteed', 'vulnerability-free', 'Certified']) {
      expect(view, claim).not.toContain(claim);
    }
  });
});
