export const KOSMOS_POLICY_VERSION = "1.0.0";

export type KosmosPolicy = {
  maxTasksPerRun: number;
  maxPriority: number;
  minEvidenceConfidence: number;
  requireHumanApprovalFor: string[];
};

export const DEFAULT_KOSMOS_POLICY: KosmosPolicy = {
  maxTasksPerRun: 50,
  maxPriority: 100,
  minEvidenceConfidence: 0.7,
  requireHumanApprovalFor: [
    "external_write",
    "credential_use",
    "production_change",
    "outbound_message",
  ],
};

export function requiresApproval(taskType: string, policy = DEFAULT_KOSMOS_POLICY) {
  return policy.requireHumanApprovalFor.includes(taskType);
}
