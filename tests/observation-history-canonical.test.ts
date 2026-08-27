import { describe, expect, it } from 'vitest';
import { classifyCanonicalChange, compareCanonicalObservations } from '../src/utils/observation-history.ts';

const baseline = { score: 80, confidence: 9000, completenessBasisPoints: 8000, findingIds: ['f1'] };

describe('compareCanonicalObservations', () => {
  it('reports no changes when there is no previous observation (first-ever observation)', () => {
    expect(compareCanonicalObservations(null, baseline)).toEqual([]);
  });

  it('reports no changes when nothing differs', () => {
    expect(compareCanonicalObservations(baseline, { ...baseline })).toEqual([]);
  });

  it('detects a score decrease', () => {
    const changes = compareCanonicalObservations(baseline, { ...baseline, score: 65 });
    expect(changes).toContainEqual({ type: 'score_decreased', before: 80, after: 65 });
  });

  it('detects a score increase', () => {
    const changes = compareCanonicalObservations(baseline, { ...baseline, score: 95 });
    expect(changes).toContainEqual({ type: 'score_increased', before: 80, after: 95 });
  });

  it('detects a score becoming ineligible (was computable, now null)', () => {
    const changes = compareCanonicalObservations(baseline, { ...baseline, score: null });
    expect(changes).toContainEqual({ type: 'score_became_ineligible', before: 80, after: null });
  });

  it('detects a score becoming eligible (was null, now computable)', () => {
    const changes = compareCanonicalObservations({ ...baseline, score: null }, baseline);
    expect(changes).toContainEqual({ type: 'score_became_eligible', before: null, after: 80 });
  });

  it('detects confidence and completeness moving in either direction', () => {
    const dropped = compareCanonicalObservations(baseline, { ...baseline, confidence: 7000, completenessBasisPoints: 6000 });
    expect(dropped).toContainEqual({ type: 'confidence_decreased', before: 9000, after: 7000 });
    expect(dropped).toContainEqual({ type: 'completeness_decreased', before: 8000, after: 6000 });
    const rose = compareCanonicalObservations(baseline, { ...baseline, confidence: 9500, completenessBasisPoints: 9000 });
    expect(rose).toContainEqual({ type: 'confidence_increased', before: 9000, after: 9500 });
    expect(rose).toContainEqual({ type: 'completeness_increased', before: 8000, after: 9000 });
  });

  it('detects a new finding and a resolved finding independently', () => {
    const created = compareCanonicalObservations(baseline, { ...baseline, findingIds: ['f1', 'f2'] });
    expect(created).toContainEqual({ type: 'finding_created', subject: 'f2', before: null, after: 'f2' });
    const resolved = compareCanonicalObservations(baseline, { ...baseline, findingIds: [] });
    expect(resolved).toContainEqual({ type: 'finding_resolved', subject: 'f1', before: 'f1', after: null });
  });

  it('reports nothing for null-to-null and equal-value edge cases', () => {
    const bothNull = compareCanonicalObservations({ ...baseline, score: null }, { ...baseline, score: null });
    expect(bothNull.find((c) => c.type.startsWith('score_'))).toBeUndefined();
  });
});

describe('classifyCanonicalChange', () => {
  it('always flags a score becoming ineligible as high severity and alert-worthy', () => {
    expect(classifyCanonicalChange({ type: 'score_became_ineligible', before: 80, after: null })).toEqual({ alertWorthy: true, severity: 'high' });
  });

  it('classifies a large score drop (>=15) as high, a small one as medium, both alert-worthy', () => {
    expect(classifyCanonicalChange({ type: 'score_decreased', before: 80, after: 60 })).toEqual({ alertWorthy: true, severity: 'high' });
    expect(classifyCanonicalChange({ type: 'score_decreased', before: 80, after: 72 })).toEqual({ alertWorthy: true, severity: 'medium' });
  });

  it('only flags a completeness drop as alert-worthy once it crosses 10 percentage points (1000 bp)', () => {
    expect(classifyCanonicalChange({ type: 'completeness_decreased', before: 8000, after: 7500 })).toEqual({ alertWorthy: false, severity: 'medium' });
    expect(classifyCanonicalChange({ type: 'completeness_decreased', before: 8000, after: 6900 })).toEqual({ alertWorthy: true, severity: 'medium' });
    expect(classifyCanonicalChange({ type: 'completeness_decreased', before: 8000, after: 5900 })).toEqual({ alertWorthy: true, severity: 'high' });
  });

  it('only flags a confidence drop as alert-worthy once it crosses 15 percentage points (1500 bp)', () => {
    expect(classifyCanonicalChange({ type: 'confidence_decreased', before: 9000, after: 8000 })).toEqual({ alertWorthy: false, severity: 'medium' });
    expect(classifyCanonicalChange({ type: 'confidence_decreased', before: 9000, after: 7400 })).toEqual({ alertWorthy: true, severity: 'medium' });
  });

  it('treats a new finding as always alert-worthy at medium severity', () => {
    expect(classifyCanonicalChange({ type: 'finding_created', subject: 'f9', before: null, after: 'f9' })).toEqual({ alertWorthy: true, severity: 'medium' });
  });

  it('treats improvements (score/confidence/completeness increases, finding resolution) as informational, never alert-worthy', () => {
    expect(classifyCanonicalChange({ type: 'score_increased', before: 60, after: 80 })).toEqual({ alertWorthy: false, severity: 'informational' });
    expect(classifyCanonicalChange({ type: 'confidence_increased', before: 7000, after: 9000 })).toEqual({ alertWorthy: false, severity: 'informational' });
    expect(classifyCanonicalChange({ type: 'completeness_increased', before: 6000, after: 9000 })).toEqual({ alertWorthy: false, severity: 'informational' });
    expect(classifyCanonicalChange({ type: 'finding_resolved', subject: 'f1', before: 'f1', after: null })).toEqual({ alertWorthy: false, severity: 'informational' });
    expect(classifyCanonicalChange({ type: 'score_became_eligible', before: null, after: 80 })).toEqual({ alertWorthy: false, severity: 'informational' });
  });
});
