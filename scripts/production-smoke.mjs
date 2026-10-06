// final production closure verification: behavior unchanged; this comment triggers the external smoke workflow.
import https from 'node:https';
import crypto from 'node:crypto';
const API = process.env.SPR_PRODUCTION_API || 'https://spr-app-production-production-4d46.up.railway.app';
const WEB = process.env.SPR_PRODUCTION_WEB || 'https://softwarepassportregistry.com';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({name,status:'PASS'}); console.log('PASS', name); }
  catch (error) { results.push({name,status:'FAIL',error:error instanceof Error ? error.message : String(error)}); console.error('FAIL', name, error); process.exitCode=1; }
}
function assert(condition, message) { if (!condition) throw new Error(message); }

await check('api health 200', async () => {
  const r = await fetch(API + '/health', {redirect:'manual'});
  assert(r.status === 200, `expected 200 got ${r.status}`);
  const body = await r.json();
  assert(body.status === 'ok', `unexpected status ${JSON.stringify(body)}`);
});

await check('api readiness proves database rls least privilege', async () => {
  const r = await fetch(API + '/ready', {redirect:'manual'});
  assert(r.status === 200, `expected 200 got ${r.status}`);
  const body = await r.json();
  assert(body.status === 'ready', 'status not ready');
  assert(body.checks?.database?.ok === true, 'database not ready');
  assert(body.checks?.tenantRls?.ok === true, 'tenant RLS assertion failed');
  assert(body.checks?.runtimeRole?.leastPrivilege === true, 'runtime role is not least privileged');
  assert(body.checks?.runtimeRole?.role === 'spr_app_runtime', `unexpected runtime role ${body.checks?.runtimeRole?.role}`);
});

await check('anonymous protected route rejected', async () => {
  const r = await fetch(API + '/api/vendors', {redirect:'manual'});
  assert(r.status === 401 || r.status === 403, `expected 401/403 got ${r.status}`);
});

await check('malformed bearer rejected', async () => {
  const r = await fetch(API + '/api/vendors', {headers:{authorization:'Bearer not-a-real-token'},redirect:'manual'});
  assert(r.status === 401 || r.status === 403, `expected 401/403 got ${r.status}`);
});

await check('anonymous mutation rejected', async () => {
  const r = await fetch(API + '/api/vendors', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'DO-NOT-CREATE'})});
  assert(r.status === 401 || r.status === 403, `expected 401/403 got ${r.status}`);
});

await check('TRACE rejected', async () => {
  const status = await new Promise((resolve, reject) => {
    const target = new URL(API + '/health');
    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname,
      method: 'TRACE',
      rejectUnauthorized: true,
    }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once('error', reject);
    request.end();
  });
  assert(status === 405, `expected 405 got ${status}`);
});

await check('hostile origin not reflected', async () => {
  const r = await fetch(API + '/health', {headers:{origin:'https://evil.invalid'},redirect:'manual'});
  assert(!r.headers.get('access-control-allow-origin'), 'hostile origin received ACAO');
});

await check('baseline security headers', async () => {
  const r = await fetch(API + '/health', {redirect:'manual'});
  assert((r.headers.get('x-content-type-options') || '').toLowerCase() === 'nosniff', 'missing nosniff');
  assert((r.headers.get('x-frame-options') || '').toLowerCase() === 'deny', 'missing DENY frame protection');
  assert(Boolean(r.headers.get('content-security-policy')), 'missing CSP');
});




await check('production intake signs uploads and hashes observed bytes', async () => {
  const payload = Buffer.from('spr-intake-production-proof-v1\n', 'utf8');
  const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

  const sessionResponse = await fetch(API + '/api/intake/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const sessionText = await sessionResponse.text();
  assert(sessionResponse.status === 201, `session expected 201 got ${sessionResponse.status}: ${sessionText.slice(0, 300)}`);
  const session = JSON.parse(sessionText);
  assert(/^intake_[a-f0-9]{32}$/.test(session.sessionId || ''), 'invalid intake session id');

  const signResponse = await fetch(API + '/api/intake/upload-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.sessionId,
      file: {
        name: 'spr-production-proof.txt',
        size: payload.length,
        contentType: 'text/plain',
        kind: 'document',
      },
    }),
  });
  const signedText = await signResponse.text();
  assert(signResponse.status === 201, `upload-url expected 201 got ${signResponse.status}: ${signedText.slice(0, 300)}`);
  const signed = JSON.parse(signedText);
  assert(/^item_[a-f0-9]{32}$/.test(signed.itemId || ''), 'invalid intake item id');
  assert(typeof signed.signedUrl === 'string' && signed.signedUrl.startsWith('https://'), 'missing signed upload URL');

  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', new Blob([payload], { type: 'text/plain' }), 'spr-production-proof.txt');
  const uploadResponse = await fetch(signed.signedUrl, { method: 'PUT', body: form });
  assert(uploadResponse.ok, `signed storage upload failed ${uploadResponse.status}: ${(await uploadResponse.text()).slice(0, 300)}`);

  const completeResponse = await fetch(API + '/api/intake/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.sessionId,
      itemId: signed.itemId,
      sha256: expectedSha,
    }),
  });
  const completeText = await completeResponse.text();
  assert(completeResponse.status === 200, `complete expected 200 got ${completeResponse.status}: ${completeText.slice(0, 300)}`);
  const completed = JSON.parse(completeText);
  assert(completed.status === 'UPLOADED', `unexpected intake status ${completed.status}`);
  assert(completed.sha256 === expectedSha, `server hash mismatch: expected ${expectedSha} got ${completed.sha256}`);
});

await check('production anonymous IP rate limit returns 429', async () => {
  let limited = null;
  for (let i = 0; i < 110; i += 1) {
    const r = await fetch(API + '/api/vendors', {redirect:'manual'});
    if (r.status === 429) {
      limited = r;
      break;
    }
    assert(r.status === 401 || r.status === 403, `expected protected-route rejection before limit, got ${r.status} at request ${i + 1}`);
  }
  assert(limited, 'no 429 observed for one anonymous source within 110 requests');
  assert(Boolean(limited.headers.get('retry-after')), '429 missing Retry-After');
  assert(Boolean(limited.headers.get('x-ratelimit-limit')), '429 missing X-RateLimit-Limit');
  assert(Boolean(limited.headers.get('x-ratelimit-policy')), '429 missing X-RateLimit-Policy');
});

await check('production credential rate limit resists forwarding-header rotation', async () => {
  let limited = null;
  const syntheticKey = 'spr-smoke-rate-limit-proof-v1';
  for (let i = 0; i < 110; i += 1) {
    const r = await fetch(API + '/api/vendors', {
      redirect:'manual',
      headers:{
        'x-api-key': syntheticKey,
        'x-forwarded-for': `198.51.100.${(i % 200) + 1}`,
      },
    });
    if (r.status === 429) {
      limited = r;
      break;
    }
    assert(r.status === 401 || r.status === 403, `expected protected-route rejection before limit, got ${r.status} at request ${i + 1}`);
  }
  assert(limited, 'no 429 observed for a stable credential within 110 requests');
  assert(Boolean(limited.headers.get('retry-after')), '429 missing Retry-After');
  assert(Boolean(limited.headers.get('x-ratelimit-limit')), '429 missing X-RateLimit-Limit');
  assert(Boolean(limited.headers.get('x-ratelimit-policy')), '429 missing X-RateLimit-Policy');
});

await check('public registry index returns JSON', async () => {
  const r = await fetch(API + '/software/index.json', {redirect:'manual'});
  const text = await r.text();
  assert(r.status === 200, `expected 200 got ${r.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  assert(typeof body.total === 'number', 'registry total is not numeric');
  assert(Array.isArray(body.entries), 'registry entries is not an array');
});

await check('public frontend reachable', async () => {
  const r = await fetch(WEB + '/', {redirect:'follow'});
  assert(r.status === 200, `expected 200 got ${r.status}`);
  const text = await r.text();
  assert(text.length > 500, 'frontend response unexpectedly small');
});

await check('authenticated SPA route serves shell', async () => {
  const r = await fetch(WEB + '/vendor-evidence-exchange', {redirect:'follow'});
  assert(r.status === 200, `expected 200 got ${r.status}`);
  const text = await r.text();
  assert(/<html|<!doctype/i.test(text), 'route did not return an HTML shell');
});

console.log(JSON.stringify({target:{API,WEB},results}, null, 2));
if (results.some(r => r.status === 'FAIL')) process.exit(1);
