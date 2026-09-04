export type ExecutiveFinding = {
  title: string;
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'informational';
  businessImpact: string;
  recommendedAction: string;
  ownerAction?: string;
  evidenceCount?: number;
};

export type ExecutiveSummary = {
  headline: string;
  exposure: string;
  priority: 'critical' | 'high' | 'moderate' | 'low' | 'clear';
  findings: ExecutiveFinding[];
  nextSteps: string[];
};

const rank: Record<ExecutiveSummary['priority'], number> = { critical: 5, high: 4, moderate: 3, low: 2, clear: 1 };

export function buildExecutiveSummary(findings: ExecutiveFinding[]): ExecutiveSummary {
  const ordered = [...findings].sort((a, b) => {
    const weight: Record<ExecutiveFinding['severity'], number> = { critical: 5, high: 4, moderate: 3, low: 2, informational: 1 };
    return weight[b.severity] - weight[a.severity];
  });
  const priority = ordered.length ? (ordered[0].severity === 'informational' ? 'clear' : ordered[0].severity) : 'clear';
  const exposure = ordered.length === 0
    ? 'No material findings were identified from the evidence available at the time of assessment.'
    : `${ordered.length} finding${ordered.length === 1 ? '' : 's'} require${ordered.length === 1 ? 's' : ''} attention. Priority is ${priority}.`;
  const nextSteps = ordered.slice(0, 5).map(f => f.recommendedAction);
  return {
    headline: priority === 'clear' ? 'No material issues identified' : `${priority.toUpperCase()} attention recommended`,
    exposure,
    priority,
    findings: ordered,
    nextSteps,
  };
}

export function executiveRiskLabel(severity: ExecutiveFinding['severity']): string {
  return severity === 'critical' ? 'Immediate business risk'
    : severity === 'high' ? 'High business risk'
    : severity === 'moderate' ? 'Action recommended'
    : severity === 'low' ? 'Monitor'
    : 'Informational';
}
