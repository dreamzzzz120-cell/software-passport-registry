import { describe, expect, it } from "vitest";
import { constructNhiEvidence, toNhiEvidenceEnvelope } from "./evidence-model";

const base = {
  kind: "ai_agent",
  externalRef: "repo:example/agent",
  label: "Example agent",
  source: "public_repository",
  sourceRef: "https://github.com/example/agent",
  observedAt: "2026-10-07T10:00:00Z",
  evidenceDigest: "sha256:" + "a".repeat(64),
  evidenceState: "OBSERVED",
};

const ctx = { tenantId: "tenant-one", now: "2026-10-08T10:00:00Z" };

describe("NHI evidence foundation", () => {
  it("preserves unknown owner and authorization", () => {
    const record = constructNhiEvidence(base, ctx);
    expect(record.ownerState).toBe("UNKNOWN");
    expect(record.authorizationState).toBe("UNKNOWN");
    expect(record.tenantId).toBe("tenant-one");
  });
  it("never accepts client-supplied tenant scope", () => {
    expect(() => constructNhiEvidence({ ...base, tenantId: "tenant-two" }, ctx)).toThrow();
  });
  it("rejects secret and credential fields", () => {
    expect(() => constructNhiEvidence({ ...base, apiKey: "sensitive" }, ctx)).toThrow();
    expect(() => constructNhiEvidence({ ...base, metadata: { accessToken: "sensitive" } }, ctx)).toThrow();
  });
  it("rejects treating attestation as observation", () => {
    expect(() => constructNhiEvidence({ ...base, source: "user_attestation" }, ctx)).toThrow();
  });
  it("rejects invalid digest and future observations", () => {
    expect(() => constructNhiEvidence({ ...base, evidenceDigest: "sha256:bad" }, ctx)).toThrow();
    expect(() => constructNhiEvidence({ ...base, observedAt: "2030-01-01T00:00:00Z" }, ctx)).toThrow();
  });
  it("exports evidence without portable authorization or trust decisions", () => {
    const envelope = toNhiEvidenceEnvelope(constructNhiEvidence(base, ctx));
    expect(envelope).not.toHaveProperty("authorizationState");
    expect(envelope).not.toHaveProperty("tenantId");
    expect(envelope).not.toHaveProperty("trustScore");
    expect(envelope).toHaveProperty("evidenceDigest");
  });
});
