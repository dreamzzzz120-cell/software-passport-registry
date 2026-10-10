import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('growth funnel truth contracts', () => {
  it('counts signup_started on actual signup submission, not on signup page view', () => {
    const source = readFileSync('src/components/LoginView.tsx', 'utf8');
    const signupBlock = source.slice(source.indexOf("if (mode === 'signup')"), source.indexOf("// A stale refresh/session record"));
    expect(signupBlock).toContain("trackGrowthEvent('signup_started')");
    expect(source).not.toContain("if (mode !== 'signup' || signupTracked.current) return;");
  });

  it('offers a client-ready Free Review conversion and trial handoff', () => {
    const source = readFileSync('src/components/FreeReviewPdfGate.tsx', 'utf8');
    expect(source).toContain('Take this evidence into a client conversation');
    expect(source).toContain('Get my client-ready PDF');
    expect(source).toContain("window.location.assign('/login?mode=signup&next=%2Fbilling')");
  });

  it('keeps founder sessions and internal sub-engine failures out of acquisition headline metrics', () => {
    const source = readFileSync('src/lib/server/founder/overview.ts', 'utf8');
    expect(source).toContain("f.path = '/founder'");
    expect(source).toContain("job_type='repository_scan' AND status='Failed'");
    expect(source).toContain("job_type='repository_scan' AND status='Running'");
    expect(source).toContain("job_type='repository_scan' AND status='Pending'");
  });
});
