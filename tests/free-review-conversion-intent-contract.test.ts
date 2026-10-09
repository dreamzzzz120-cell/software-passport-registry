import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const review = fs.readFileSync(path.join(root, 'src/components/FreeReviewView.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const analytics = fs.readFileSync(path.join(root, 'src/analytics.ts'), 'utf8');

describe('Free Review conversion instrumentation', () => {
  it('tracks signup intent on both completed-report signup CTAs before navigating', () => {
    expect(review).toContain("trackGrowthEvent('signup_started');\n    onSignUp();");
    expect((review.match(/onClick=\{startSignupFromReview\}/g) ?? []).length).toBe(2);
    expect(review).not.toContain('onClick={onSignUp}');
  });

  it('preserves the tokenized public result as the post-signup destination', () => {
    expect(app).toContain("const freeReviewReturnPath = freeReviewResult");
    expect(app).toContain('encodeURIComponent(freeReviewReturnPath)');
  });

  it('uses the existing allowed signup_started event without inventing a successful signup', () => {
    expect(analytics).toContain("'signup_started'");
    expect(review).not.toContain("trackGrowthEvent('signup_completed')");
  });
});
