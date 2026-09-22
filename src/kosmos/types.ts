export type KosmosSeverity = "info" | "low" | "medium" | "high" | "critical";
export type KosmosStatus = "queued" | "running" | "validated" | "rejected" | "failed";

export type KosmosEvidence = {
  id: string;
  source: string;
  kind: string;
  observedAt: string;
  contentHash: string;
  confidence: number;
  claims: Record<string, unknown>;
};

export type KosmosFinding = {
  id: string;
  severity: KosmosSeverity;
  category: string;
  title: string;
  description: string;
  evidenceIds: string[];
  confidence: number;
  status: "open" | "validated" | "rejected";
};

export type KosmosTask = {
  id: string;
  type: string;
  targetId: string;
  reason: string;
  priority: number;
  createdAt: string;
  status: KosmosStatus;
  evidenceIds: string[];
  findingIds: string[];
  requiresApproval: boolean;
};

export type KosmosRun = {
  id: string;
  startedAt: string;
  completedAt?: string;
  scope: { tenantId?: string; softwareIds?: string[] };
  tasks: KosmosTask[];
  evidence: KosmosEvidence[];
  findings: KosmosFinding[];
  policyVersion: string;
};
