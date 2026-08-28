import { describe, expect, it } from 'vitest';
import { buildSavingsReport, type ActivityCounts } from '../src/trust/savings-report.ts';

const ZERO_ACTIVITY: ActivityCounts = {
  reportsGenerated: 0, questionnaireItemsAnswered: 0, questionnaireItemsNeedingReview: 0,
  vendorAuditsCompleted: 0, remediationsResolved: 0,
};

describe('buildSavingsReport', () => {
  it('never fabricates time or dollar savings when no baseline has been entered', () => {
    const activity: ActivityCounts = { ...ZERO_ACTIVITY, reportsGenerated: 12, vendorAuditsCompleted: 3 };
    const report = buildSavingsReport(30, '2026-07-01T00:00:00Z', '2026-07-31T00:00:00Z', activity, null);
    expect(report.hasBaseline).toBe(false);
    for (const line of report.timeSavings) {
      if (line.count > 0) {
        expect(line.basis).toBe('INSUFFICIENT_DATA');
        expect(line.totalMinutes).toBeNull();
      }
    }
    expect(report.laborValue.basis).toBe('INSUFFICIENT_DATA');
    expect(report.laborValue.dollarValue).toBeNull();
    expect(report.netValue.value).toBeNull();
    expect(report.activity.reportsGenerated).toBe(12);
  });

  it('reports MEASURED activity counts unconditionally, independent of baseline', () => {
    const activity: ActivityCounts = { ...ZERO_ACTIVITY, questionnaireItemsAnswered: 7, questionnaireItemsNeedingReview: 2 };
    const report = buildSavingsReport(30, 'a', 'b', activity, null);
    expect(report.activity.basis).toBe('MEASURED');
    expect(report.activity.questionnaireItemsAnswered).toBe(7);
    expect(report.activity.questionnaireItemsNeedingReview).toBe(2);
  });

  it('computes a real ESTIMATED time and dollar value once a baseline exists', () => {
    const activity: ActivityCounts = { ...ZERO_ACTIVITY, reportsGenerated: 10 };
    const baseline = {
      hourlyRate: 60, reportBaselineMinutes: 30, questionnaireQuestionBaselineMinutes: null,
      vendorReviewBaselineMinutes: null, remediationBaselineMinutes: null,
      toolConsolidationMonthlyCost: null, sprMonthlyCost: null, updatedAt: '2026-08-01T00:00:00Z',
    };
    const report = buildSavingsReport(30, 'a', 'b', activity, baseline);
    const reportLine = report.timeSavings.find((l) => l.label === 'Trust reports generated')!;
    expect(reportLine.basis).toBe('ESTIMATED');
    expect(reportLine.totalMinutes).toBe(300); // 10 * 30
    expect(report.laborValue.hours).toBe(5);
    expect(report.laborValue.dollarValue).toBe(300); // 5 hours * $60
  });

  it('does not calculate net value when SPR cost has not been entered, even if labor value is known', () => {
    const activity: ActivityCounts = { ...ZERO_ACTIVITY, reportsGenerated: 5 };
    const baseline = {
      hourlyRate: 50, reportBaselineMinutes: 20, questionnaireQuestionBaselineMinutes: null,
      vendorReviewBaselineMinutes: null, remediationBaselineMinutes: null,
      toolConsolidationMonthlyCost: 500, sprMonthlyCost: null, updatedAt: null,
    };
    const report = buildSavingsReport(30, 'a', 'b', activity, baseline);
    expect(report.laborValue.dollarValue).not.toBeNull();
    expect(report.toolConsolidation.windowValue).toBe(500);
    expect(report.netValue.value).toBeNull();
    expect(report.netValue.basis).toBe('INSUFFICIENT_DATA');
  });

  it('prorates tool consolidation and SPR cost to the requested window, not a flat monthly figure', () => {
    const baseline = {
      hourlyRate: null, reportBaselineMinutes: null, questionnaireQuestionBaselineMinutes: null,
      vendorReviewBaselineMinutes: null, remediationBaselineMinutes: null,
      toolConsolidationMonthlyCost: 300, sprMonthlyCost: 100, updatedAt: null,
    };
    const report90 = buildSavingsReport(90, 'a', 'b', ZERO_ACTIVITY, baseline);
    expect(report90.toolConsolidation.windowValue).toBe(900); // 300 * 3
    expect(report90.sprCost.windowValue).toBe(300); // 100 * 3
  });

  it('computes a full net value once every input is present', () => {
    const activity: ActivityCounts = { ...ZERO_ACTIVITY, reportsGenerated: 4 };
    const baseline = {
      hourlyRate: 100, reportBaselineMinutes: 15, questionnaireQuestionBaselineMinutes: null,
      vendorReviewBaselineMinutes: null, remediationBaselineMinutes: null,
      toolConsolidationMonthlyCost: 200, sprMonthlyCost: 150, updatedAt: null,
    };
    const report = buildSavingsReport(30, 'a', 'b', activity, baseline);
    // labor: 4*15=60min=1hr * $100 = $100; + tool 200; - spr 150 = 150
    expect(report.laborValue.dollarValue).toBe(100);
    expect(report.netValue.value).toBe(150);
    expect(report.netValue.basis).toBe('ESTIMATED');
  });

  it('the disclaimer is always present and distinguishes measured activity from estimated value', () => {
    const report = buildSavingsReport(30, 'a', 'b', ZERO_ACTIVITY, null);
    expect(report.disclaimer).toContain('MEASURED');
    expect(report.disclaimer).toContain('ESTIMATE');
  });
});
