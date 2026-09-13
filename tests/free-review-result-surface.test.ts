import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');
const result = read('src/components/FreeReviewResultView.tsx');
const view = read('src/components/FreeReviewView.tsx');

describe('Free Review result surface', () => {
  it('turns observed scan data into an executive result instead of only a status screen', () => {
    expect(result).toContain('What SPR discovered');
    expect(result).toContain('What SPR observed');
    expect(result).toContain('What SPR verified');
    expect(result).toContain('What SPR could not verify');
    expect(result).toContain('UNKNOWN');
  });

  it('shows evidence, findings and component coverage from the existing status payload', () => {
    expect(result).toContain('Evidence breakdown');
    expect(result).toContain('Signals that need attention');
    expect(result).toContain('component');
    expect(result).toContain('cryptographically verified');
  });

  it('exposes the requested conversion actions without changing the evaluator', () => {
    for (const action of ['Open Passport', 'Evidence Explorer', 'Open Findings', 'Download report', 'Share review', 'Start monitoring', 'continuous verification']) {
      expect(result, action).toContain(action);
    }
    expect(result).not.toContain('evaluateVerification');
    expect(view).not.toContain('evaluateVerification');
  });

  it('does not make unsupported business-value claims', () => {
    expect(result).toContain('does not claim money saved unless you actually measure it');
    for (const claim of ['is secure', 'is safe', 'Guaranteed', 'vulnerability-free', 'Certified']) {
      expect(result, claim).not.toContain(claim);
    }
  });

  it('keeps commit identity honest when the public status payload does not expose it', () => {
    expect(result).toContain('Review ID');
    expect(result).not.toContain('commit reviewed as verified');
  });
});
