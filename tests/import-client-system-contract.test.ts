import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');

const view = read('src/components/ImportClientSystemView.tsx');
const app = read('src/App.tsx');
const trustNetwork = read('src/components/MSPCommandCenter.tsx');
const intakeRoute = read('src/routes/universal-intake.ts');

describe('Import client system — discoverability', () => {
  it('Trust Network carries the primary import CTA and routes to the flow', () => {
    expect(trustNetwork).toContain('Import client system');
    expect(trustNetwork).toContain("onNavigate('/import-system')");
  });

  it('keeps Add client as a distinct secondary action, and explains the difference', () => {
    expect(trustNetwork).toContain('Add client');
    // The distinction has to be stated on the page, not just implied by two buttons.
    expect(trustNetwork).toMatch(/creates the organization record/i);
  });

  it('App routes /import-system to the flow', () => {
    expect(app).toContain("case '/import-system'");
    expect(app).toContain('ImportClientSystemView');
  });

  it('the empty software state offers import rather than dead-ending', () => {
    expect(trustNetwork).toMatch(/No software has been imported yet/i);
    expect(trustNetwork).toContain('Add software manually');
  });
});

describe('Import client system — reuses the existing backend, adds no API surface', () => {
  // The whole point of this flow is to be a wrapper. If it ever grows its own
  // endpoint, that endpoint would bypass the auth, tenant-scoping and validation
  // already proven on the intake routes.
  const allowed = [
    '/api/user/clients',
    '/api/intake/session',
    '/api/intake/upload-url',
    '/api/intake/complete',
    '/api/intake/claim',
  ];

  it('calls only endpoints that already exist', () => {
    const called = [...view.matchAll(/apiFetch\('([^']+)'/g)].map((m) => m[1]);
    expect(called.length).toBeGreaterThan(0);
    for (const endpoint of called) expect(allowed).toContain(endpoint);
  });

  it('claims the intake through the authenticated route, so the server assigns the tenant', () => {
    expect(view).toContain('/api/intake/claim');
    // Ownership must never be asserted by the browser.
    expect(view).not.toMatch(/tenantId\s*:/);
    expect(view).not.toMatch(/tenant_id/);
  });

  it('offers only evidence kinds the backend actually accepts', () => {
    const backendKinds = [...intakeRoute.matchAll(/z\.enum\(\[([^\]]+)\]\)/g)]
      .map((m) => m[1])
      .find((s) => s.includes('sbom'));
    expect(backendKinds).toBeTruthy();
    for (const kind of ['software', 'document', 'sbom', 'archive', 'unknown']) {
      expect(backendKinds).toContain(`'${kind}'`);
      expect(view).toContain(`'${kind}'`);
    }
  });

  it('does not invent a second upload path', () => {
    // Exactly one direct PUT: the signed URL handed back by the API.
    const puts = [...view.matchAll(/method:\s*'PUT'/g)];
    expect(puts).toHaveLength(1);
    expect(view).toContain('signedUrl');
  });
});

describe('Import client system — honesty', () => {
  it('does not claim passports, findings or trust results are produced by the upload', () => {
    const results = view.slice(view.indexOf('System received'));
    // Claiming an intake queues evidence. It does not mint passports or score
    // anything, so the result screen must not say that it does.
    expect(results).toMatch(/not created by the upload itself|Nothing here is scored yet/i);
    expect(results).not.toMatch(/passports created/i);
    expect(results).not.toMatch(/findings found/i);
  });

  it('shows only processing steps that correspond to a real request', () => {
    // Every progress line must map to a call the flow actually makes.
    const notes = [...view.matchAll(/note\('([^']+)'\)/g)].map((m) => m[1]);
    expect(notes.length).toBeGreaterThan(0);
    for (const fabricated of ['Running security analysis', 'Building trust observations', 'Creating software passports', 'Identifying software']) {
      expect(notes).not.toContain(fabricated);
    }
  });

  it('does not overstate what SPR can reach', () => {
    expect(view).toMatch(/does not reach into source code, private repositories, cloud accounts or production servers/i);
  });

  it('states the real upload limits rather than implying none', () => {
    expect(view).toContain('MAX_FILE_BYTES');
    expect(view).toContain('MAX_FILES');
    // Must match the server-side ceilings in universal-intake.ts.
    expect(intakeRoute).toContain('100 * 1024 * 1024');
    expect(view).toContain('100 * 1024 * 1024');
  });
});

describe('Import client system — accessibility and states', () => {
  it('every step has a loading, error and success path', () => {
    expect(view).toContain('animate-spin');
    expect(view).toContain('role="alert"');
    expect(view).toContain('System received');
  });

  it('exposes breadcrumbs and step progress to assistive technology', () => {
    expect(view).toContain('aria-label="Breadcrumb"');
    expect(view).toContain("aria-current={step === n ? 'step' : undefined}");
  });

  it('labels the file input and per-file controls', () => {
    expect(view).toContain('aria-label="Choose files to upload"');
    expect(view).toMatch(/aria-label=\{`Evidence type for/);
    expect(view).toMatch(/aria-label=\{`Remove/);
  });

  it('gives interactive controls a visible focus state', () => {
    expect(trustNetwork).toContain('focus-visible:outline');
  });
});

describe('Universal intake storage limits', () => {
  it('creates the bucket with a numeric byte limit, not a bytes-library string', () => {
    // `${MAX_FILE_SIZE}B` was parsed into a limit far below 100MB, and production
    // rejected an 11-byte upload with "The object exceeded the maximum allowed size".
    expect(intakeRoute).toContain('fileSizeLimit: MAX_FILE_SIZE');
    expect(intakeRoute).not.toContain('fileSizeLimit: `${MAX_FILE_SIZE}B`');
  });

  it('reconciles an existing bucket that carries the wrong limit, without widening access', () => {
    expect(intakeRoute).toContain('updateBucket');
    // Reconciliation must never flip the bucket public.
    const update = intakeRoute.slice(intakeRoute.indexOf('updateBucket'));
    expect(update.slice(0, 200)).toContain('public: false');
  });
});
