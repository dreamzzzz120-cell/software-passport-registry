import https from 'node:https';
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


await check('production API rate limit fails closed at configured threshold', async () => {
  let limited = null;
  for (let i = 0; i < 110; i += 1) {
    const r = await fetch(API + '/api/vendors', {redirect:'manual'});
    if (r.status === 429) {
      limited = r;
      break;
    }
    assert(r.status === 401 || r.status === 403, `expected protected-route rejection before limit, got ${r.status} at request ${i + 1}`);
  }
  assert(limited, 'no 429 observed within 110 requests');
  assert(Boolean(limited.headers.get('retry-after')), '429 missing Retry-After');
  assert(Boolean(limited.headers.get('x-ratelimit-limit')), '429 missing X-RateLimit-Limit');
  assert(Boolean(limited.headers.get('x-ratelimit-policy')), '429 missing X-RateLimit-Policy');
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
