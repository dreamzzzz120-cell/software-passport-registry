import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_KOSMOS_POLICY, KOSMOS_POLICY_VERSION, requiresApproval } from "./policy.js";
import type { KosmosEvidence, KosmosFinding, KosmosRun, KosmosTask } from "./types.js";

export type KosmosObservation = {
  source: string;
  kind: string;
  targetId: string;
  observedAt?: string;
  claims?: Record<string, unknown>;
  confidence?: number;
};

export type KosmosAdapter = {
  observe(targetId: string): Promise<KosmosObservation[]>;
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function toEvidence(observation: KosmosObservation): KosmosEvidence {
  const claims = observation.claims ?? {};
  return {
    id: randomUUID(),
    source: observation.source,
    kind: observation.kind,
    observedAt: observation.observedAt ?? new Date().toISOString(),
    contentHash: hash(observation),
    confidence: Math.max(0, Math.min(1, observation.confidence ?? 0)),
    claims,
  };
}

function deriveFindings(evidence: KosmosEvidence[], minConfidence: number): KosmosFinding[] {
  const findings: KosmosFinding[] = [];
  for (const item of evidence) {
    if (item.confidence < minConfidence) continue;
    if (item.claims.healthy === false) {
      findings.push({
        id: randomUUID(),
        severity: "high",
        category: "availability",
        title: "Observed unhealthy runtime",
        description: "A trusted runtime observation reported an unhealthy endpoint.",
        evidenceIds: [item.id],
        confidence: item.confidence,
        status: "open",
      });
    }
    if (item.claims.vulnerability === true) {
      findings.push({
        id: randomUUID(),
        severity: "high",
        category: "security",
        title: "Observed security vulnerability",
        description: "A trusted evidence source reported a vulnerability.",
        evidenceIds: [item.id],
        confidence: item.confidence,
        status: "open",
      });
    }
    if (item.claims.secretExposed === true) {
      findings.push({
        id: randomUUID(),
        severity: "critical",
        category: "credential-exposure",
        title: "Observed credential exposure",
        description: "Evidence indicates a secret may be exposed.",
        evidenceIds: [item.id],
        confidence: item.confidence,
        status: "open",
      });
    }
    if (item.claims.stale === true) {
      findings.push({
        id: randomUUID(),
        severity: "medium",
        category: "freshness",
        title: "Evidence is stale",
        description: "Observed evidence has exceeded its freshness policy.",
        evidenceIds: [item.id],
        confidence: item.confidence,
        status: "open",
      });
    }
  }
  return findings;
}

export async function runKosmos(scope: KosmosRun["scope"], targets: string[], adapter: KosmosAdapter): Promise<KosmosRun> {
  const policy = DEFAULT_KOSMOS_POLICY;
  const startedAt = new Date().toISOString();
  const tasks: KosmosTask[] = targets.slice(0, policy.maxTasksPerRun).map((targetId) => ({
    id: randomUUID(),
    type: "observe",
    targetId,
    reason: "Continuous trust-registry observation",
    priority: 50,
    createdAt: startedAt,
    status: "queued",
    evidenceIds: [],
    findingIds: [],
    requiresApproval: requiresApproval("observe", policy),
  }));

  const evidence: KosmosEvidence[] = [];
  for (const task of tasks) {
    task.status = "running";
    try {
      const observations = await adapter.observe(task.targetId);
      const accepted = observations.map(toEvidence).filter((item) => item.confidence >= policy.minEvidenceConfidence);
      task.evidenceIds = accepted.map((item) => item.id);
      evidence.push(...accepted);
      task.status = "validated";
    } catch {
      task.status = "failed";
    }
  }

  const findings = deriveFindings(evidence, policy.minEvidenceConfidence);
  for (const task of tasks) {
    task.findingIds = findings
      .filter((finding) => finding.evidenceIds.some((id) => task.evidenceIds.includes(id)))
      .map((finding) => finding.id);
  }

  return {
    id: randomUUID(),
    startedAt,
    completedAt: new Date().toISOString(),
    scope,
    tasks,
    evidence,
    findings,
    policyVersion: KOSMOS_POLICY_VERSION,
  };
}
