export type NormalizedSeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Unknown';

export type SeverityAssessment = {
  severity: NormalizedSeverity;
  rationale: string;
  cvssScores: number[];
  cvssVectors: string[];
  sourceSeverities: string[];
};

function scoreToSeverity(score: number): NormalizedSeverity {
  if (score >= 9) return 'Critical';
  if (score >= 7) return 'High';
  if (score >= 4) return 'Medium';
  return 'Low';
}

function cvssScore(value: unknown): number | null {
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 10 ? score : null;
}

export function assessOsvSeverity(vulnerability: any): SeverityAssessment {
  const cvssScores: number[] = [];
  const cvssVectors: string[] = [];
  const sourceSeverities: string[] = [];
  const direct = vulnerability?.database_specific?.severity;
  if (typeof direct === 'string' && ['critical', 'high', 'medium', 'low'].includes(direct.trim().toLowerCase())) {
    sourceSeverities.push(direct.trim());
  }
  for (const item of Array.isArray(vulnerability?.severity) ? vulnerability.severity : []) {
    const score = cvssScore(item?.score);
    if (score !== null) cvssScores.push(score);
    if (typeof item?.score === 'string') {
      const vector = item.score.match(/CVSS:[0-9.]+\/[A-Z0-9:/+.-]+/i)?.[0];
      if (vector) cvssVectors.push(vector);
    }
  }
  const sourceSeverity = sourceSeverities[0];
  if (sourceSeverity) {
    const severity = sourceSeverity[0].toUpperCase() + sourceSeverity.slice(1).toLowerCase() as NormalizedSeverity;
    return { severity, rationale: `OSV database_specific.severity=${sourceSeverity}`, cvssScores, cvssVectors, sourceSeverities };
  }
  if (cvssScores.length > 0) {
    const score = Math.max(...cvssScores);
    return { severity: scoreToSeverity(score), rationale: `Highest numeric CVSS score=${score}`, cvssScores, cvssVectors, sourceSeverities };
  }
  if (cvssVectors.length > 0) {
    return { severity: 'Unknown', rationale: `CVSS vector preserved without a numeric base score: ${cvssVectors.join(', ')}`, cvssScores, cvssVectors, sourceSeverities };
  }
  return { severity: 'Unknown', rationale: 'No recognized OSV severity or numeric CVSS score was provided', cvssScores, cvssVectors, sourceSeverities };
}
