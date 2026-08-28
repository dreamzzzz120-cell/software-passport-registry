/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// MSP Time & Tool Savings / ROI: a pure presentation+math layer, exactly
// like plain-english-report.ts -- no DB access, no scoring changes. It
// turns real, already-counted SPR activity into a savings estimate, but
// ONLY once the customer has supplied their own time/cost baseline. SPR
// never invents an industry-average minutes-per-task or dollar figure on
// the customer's behalf: every number here is either MEASURED (a literal
// count from SPR's own tables), CUSTOMER_PROVIDED (typed in by the user),
// ESTIMATED (measured count x customer-provided baseline), or
// INSUFFICIENT_DATA (the honest answer when no baseline exists yet).

export type ActivityCounts = {
  reportsGenerated: number;
  questionnaireItemsAnswered: number;
  questionnaireItemsNeedingReview: number;
  vendorAuditsCompleted: number;
  remediationsResolved: number;
};

export type SavingsBaseline = {
  hourlyRate: number | null;
  reportBaselineMinutes: number | null;
  questionnaireQuestionBaselineMinutes: number | null;
  vendorReviewBaselineMinutes: number | null;
  remediationBaselineMinutes: number | null;
  toolConsolidationMonthlyCost: number | null;
  sprMonthlyCost: number | null;
  updatedAt: string | null;
} | null;

export type Basis = 'MEASURED' | 'CUSTOMER_PROVIDED' | 'ESTIMATED' | 'INSUFFICIENT_DATA';

export type TimeSavingsLine = {
  label: string;
  count: number;
  minutesPerUnit: number | null;
  totalMinutes: number | null;
  basis: Basis;
  explanation: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function timeSavingsLine(label: string, count: number, minutesPerUnit: number | null, explanation: string): TimeSavingsLine {
  if (count === 0) {
    return { label, count: 0, minutesPerUnit, totalMinutes: null, basis: 'INSUFFICIENT_DATA', explanation: `No qualifying activity in this window yet.` };
  }
  if (minutesPerUnit === null || minutesPerUnit <= 0) {
    return {
      label, count, minutesPerUnit: null, totalMinutes: null, basis: 'INSUFFICIENT_DATA',
      explanation: `${explanation} No time baseline has been entered for this activity yet, so SPR cannot estimate time saved -- it will not guess.`,
    };
  }
  return { label, count, minutesPerUnit, totalMinutes: round2(count * minutesPerUnit), basis: 'ESTIMATED', explanation };
}

export type SavingsReport = {
  windowDays: number;
  since: string;
  until: string;
  hasBaseline: boolean;
  baselineUpdatedAt: string | null;
  activity: ActivityCounts & { basis: 'MEASURED' };
  timeSavings: TimeSavingsLine[];
  laborValue: { hours: number | null; dollarValue: number | null; basis: Basis; explanation: string };
  toolConsolidation: { windowValue: number | null; basis: Basis; explanation: string };
  sprCost: { windowValue: number | null; basis: Basis; explanation: string };
  netValue: { value: number | null; basis: Basis; explanation: string };
  disclaimer: string;
};

export function buildSavingsReport(windowDays: number, since: string, until: string, activity: ActivityCounts, baseline: SavingsBaseline): SavingsReport {
  const timeSavings: TimeSavingsLine[] = [
    timeSavingsLine(
      'Trust reports generated', activity.reportsGenerated, baseline?.reportBaselineMinutes ?? null,
      'Each is a real, evidence-backed report SPR generated instead of someone assembling one by hand.',
    ),
    timeSavingsLine(
      'Questionnaire questions answered from evidence', activity.questionnaireItemsAnswered, baseline?.questionnaireQuestionBaselineMinutes ?? null,
      'Counts real questionnaire items SPR matched to existing evidence and drafted an answer for.',
    ),
    timeSavingsLine(
      'Vendor audits completed', activity.vendorAuditsCompleted, baseline?.vendorReviewBaselineMinutes ?? null,
      'Counts real vendor audit attestations lodged in the Vendor Risk ledger.',
    ),
    timeSavingsLine(
      'Remediations resolved', activity.remediationsResolved, baseline?.remediationBaselineMinutes ?? null,
      'Counts real remediation work items marked VERIFIED or CLOSED against evidence.',
    ),
  ];

  const estimatedLines = timeSavings.filter((l) => l.basis === 'ESTIMATED');
  const totalMinutes = estimatedLines.length ? estimatedLines.reduce((sum, l) => sum + (l.totalMinutes ?? 0), 0) : null;

  const laborValue: SavingsReport['laborValue'] = (() => {
    if (totalMinutes === null) {
      return { hours: null, dollarValue: null, basis: 'INSUFFICIENT_DATA', explanation: 'No time baseline has been entered yet, so labor value cannot be estimated.' };
    }
    const hours = round2(totalMinutes / 60);
    if (!baseline?.hourlyRate) {
      return { hours, dollarValue: null, basis: 'INSUFFICIENT_DATA', explanation: `Estimated at ${hours} hours saved, but no hourly rate has been entered yet, so a dollar value cannot be calculated.` };
    }
    return {
      hours, dollarValue: round2(hours * baseline.hourlyRate), basis: 'ESTIMATED',
      explanation: `Estimated from ${hours} hours saved at your entered rate of $${baseline.hourlyRate}/hour.`,
    };
  })();

  const windowFraction = windowDays / 30;

  const toolConsolidation: SavingsReport['toolConsolidation'] = baseline?.toolConsolidationMonthlyCost
    ? { windowValue: round2(baseline.toolConsolidationMonthlyCost * windowFraction), basis: 'CUSTOMER_PROVIDED', explanation: 'From your entered monthly tool-consolidation savings, prorated to this window.' }
    : { windowValue: null, basis: 'INSUFFICIENT_DATA', explanation: 'No tool-consolidation savings figure has been entered yet.' };

  const sprCost: SavingsReport['sprCost'] = baseline?.sprMonthlyCost
    ? { windowValue: round2(baseline.sprMonthlyCost * windowFraction), basis: 'CUSTOMER_PROVIDED', explanation: 'From your entered SPR monthly cost, prorated to this window.' }
    : { windowValue: null, basis: 'INSUFFICIENT_DATA', explanation: 'No SPR cost figure has been entered yet.' };

  const netValue: SavingsReport['netValue'] = (() => {
    if (laborValue.dollarValue === null && toolConsolidation.windowValue === null) {
      return { value: null, basis: 'INSUFFICIENT_DATA', explanation: 'No labor-value or tool-consolidation figures are available yet, so net value cannot be estimated.' };
    }
    if (sprCost.windowValue === null) {
      return { value: null, basis: 'INSUFFICIENT_DATA', explanation: 'Gains can be partly estimated, but no SPR cost has been entered yet, so net value cannot be calculated.' };
    }
    const gain = (laborValue.dollarValue ?? 0) + (toolConsolidation.windowValue ?? 0);
    return { value: round2(gain - sprCost.windowValue), basis: 'ESTIMATED', explanation: `Estimated labor value plus tool-consolidation savings, minus your entered SPR cost, for this ${windowDays}-day window.` };
  })();

  return {
    windowDays, since, until,
    hasBaseline: !!baseline,
    baselineUpdatedAt: baseline?.updatedAt ?? null,
    activity: { ...activity, basis: 'MEASURED' },
    timeSavings,
    laborValue,
    toolConsolidation,
    sprCost,
    netValue,
    disclaimer: 'Activity counts (reports, questions answered, audits, remediations) are MEASURED directly from SPR\'s own records. All time, dollar, and net-value figures are ESTIMATES built only from the hourly rate and time/cost baselines you provide -- SPR does not know your team\'s actual efficiency and never substitutes an industry-average figure in place of your own numbers.',
  };
}
