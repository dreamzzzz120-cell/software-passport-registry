import { z } from "zod";

/**
 * Passive NHI observation contract. This module grants no permissions and
 * intentionally has no database, network or credential-handling side effects.
 * Tenant identity comes from the authenticated server context, never input.
 */
export const NhiKind = z.enum([
  "service_account", "workload", "api_client", "bot", "ai_agent", "certificate",
]);
export const EvidenceState = z.enum(["OBSERVED", "CLAIMED", "UNKNOWN"]);
export const EvidenceSource = z.enum([
  "public_repository", "authorized_provider", "user_attestation",
]);

const safeText = (max: number) => z.string().trim().min(1).max(max);
export const NhiObservationInput = z.object({
  kind: NhiKind,
  externalRef: safeText(512),
  label: safeText(256),
  source: EvidenceSource,
  sourceRef: safeText(1024),
  observedAt: z.iso.datetime({ offset: true }),
  evidenceDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  evidenceState: EvidenceState,
  ownerRef: safeText(256).nullable().default(null),
  permissions: z.array(safeText(256)).max(100).default([]),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
}).strict().superRefine((record, ctx) => {
  if (record.evidenceState === "OBSERVED" && record.source === "user_attestation") {
    ctx.addIssue({
      code: "custom",
      path: ["evidenceState"],
      message: "Attestations are claims, not independently observed evidence",
    });
  }
});

export type NhiObservationInput = z.infer<typeof NhiObservationInput>;
export type NhiEvidenceRecord = Readonly<NhiObservationInput & {
  tenantId: string;
  recordedAt: string;
  ownerState: "DOCUMENTED" | "UNKNOWN";
  authorizationState: "UNKNOWN";
}>;

const prohibitedKey = /(?:secret|password|token|private.?key|authorization|credential|api.?key)/i;

/** Fail closed on credential-like input fields, including nested objects. */
export function assertNoCredentialFields(value: unknown): void {
  const visit = (node: unknown, depth: number): void => {
    if (depth > 12) throw new Error("Input exceeds safe nesting depth");
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
    } else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (prohibitedKey.test(key)) throw new Error("Credential fields must never be recorded");
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
}

/**
 * Only call with tenantId obtained from an authenticated, server-verified context.
 * Not a persistence API: the caller must apply tenant-scoped RLS independently.
 */
export function constructNhiEvidence(
  raw: unknown,
  context: { tenantId: string; now: string },
): NhiEvidenceRecord {
  assertNoCredentialFields(raw);
  const tenantId = context.tenantId.trim();
  if (!tenantId) throw new Error("Verified tenant context required");
  const now = z.iso.datetime({ offset: true }).parse(context.now);
  const parsed = NhiObservationInput.parse(raw);
  if (Date.parse(parsed.observedAt) > Date.parse(now)) {
    throw new Error("Observation timestamp cannot be in the future");
  }
  return Object.freeze({
    ...parsed,
    permissions: [...parsed.permissions],
    tenantId,
    recordedAt: now,
    ownerState: parsed.ownerRef ? "DOCUMENTED" as const : "UNKNOWN" as const,
    authorizationState: "UNKNOWN" as const,
  });
}

/** Portable evidence only. Never export tenant authorization or trust scores. */
export function toNhiEvidenceEnvelope(record: NhiEvidenceRecord) {
  return {
    kind: record.kind,
    externalRef: record.externalRef,
    source: record.source,
    sourceRef: record.sourceRef,
    observedAt: record.observedAt,
    evidenceDigest: record.evidenceDigest,
    evidenceState: record.evidenceState,
  } as const;
}
