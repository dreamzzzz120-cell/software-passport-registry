import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('production load verification contracts', () => {
  it('keeps the load profile non-destructive and bounded', () => {
    const source = read('load/production-smoke.js');
    expect(source).toContain("const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:5000')");
    expect(source).toContain("'/api/health'");
    expect(source).toContain("'/ready'");
    expect(source).toContain("'/api/user/me'");
    expect(source).toContain("rate: Number(__ENV.PUBLIC_RATE || 5)");
    expect(source).toContain("rate: Number(__ENV.AUTH_RATE || 2)");
    expect(source).toContain("http_req_failed: ['rate<0.01']");
    expect(source).toContain("http_req_duration: ['p(95)<750', 'p(99)<1500']");
    expect(source).not.toContain('POST');
    expect(source).not.toContain('DELETE');
    expect(source).not.toContain('PATCH');
  });

  it('requires an explicit target for the manual workflow', () => {
    const workflow = read('.github/workflows/production-load.yml');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("required: true");
    expect(workflow).toContain('grafana/k6:0.52.0');
    expect(workflow).toContain('SPR_LOAD_TEST_ID_TOKEN');
  });
});
