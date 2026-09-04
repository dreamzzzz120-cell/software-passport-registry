import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const idToken = __ENV.SPR_ID_TOKEN || '';
const authenticatedErrorRate = new Rate('authenticated_error_rate');

export const options = {
  scenarios: {
    public_smoke: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.PUBLIC_RATE || 5),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: Number(__ENV.PUBLIC_VUS || 10),
      maxVUs: Number(__ENV.PUBLIC_MAX_VUS || 50),
      exec: 'publicSmoke',
    },
    auth_smoke: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.AUTH_RATE || 2),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: Number(__ENV.AUTH_VUS || 5),
      maxVUs: Number(__ENV.AUTH_MAX_VUS || 20),
      exec: 'authSmoke',
      startTime: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<750', 'p(99)<1500'],
    authenticated_error_rate: ['rate<0.05'],
  },
};

const publicPaths = ['/', '/api/health', '/ready'];

export function publicSmoke() {
  const path = publicPaths[Math.floor(Math.random() * publicPaths.length)];
  const response = http.get(`${baseUrl}${path}`, { tags: { route: path } });
  check(response, {
    'public endpoint responds': (r) => r.status >= 200 && r.status < 500,
    'public endpoint is not a server error': (r) => r.status < 500,
  });
  sleep(0.1);
}

export function authSmoke() {
  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const response = http.get(`${baseUrl}/api/user/me`, { headers, tags: { route: '/api/user/me' } });
  const valid = idToken
    ? response.status >= 200 && response.status < 500
    : response.status === 401 || response.status === 403;
  authenticatedErrorRate.add(!valid);
  check(response, {
    'auth boundary behaves correctly': () => valid,
    'auth endpoint is not a server error': (r) => r.status < 500,
  });
  sleep(0.1);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify({
      checks: data.metrics.checks,
      http_req_failed: data.metrics.http_req_failed,
      http_req_duration: data.metrics.http_req_duration,
      authenticated_error_rate: data.metrics.authenticated_error_rate,
    }, null, 2),
  };
}
