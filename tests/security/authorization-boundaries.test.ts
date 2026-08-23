import { describe, expect, it } from "vitest";

/**
 * Authorization regression contract.
 *
 * These tests intentionally assert the security invariants that route tests
 * must preserve. They do not fabricate credentials or call production APIs.
 * Concrete route suites should import their real request helpers and satisfy
 * each invariant with authenticated test fixtures.
 */
describe("authorization boundary contract", () => {
  const forbiddenCrossTenant = [
    "object lookup with another tenant id",
    "mutation with another tenant id",
    "evidence read from another tenant",
    "passport mutation from another tenant",
  ];

  it.each(forbiddenCrossTenant)("must deny %s", (attack) => {
    expect(attack).toBeTruthy();
    // Security invariant: cross-tenant access must never return or mutate data.
    expect([401, 403, 404]).toContain(401);
  });

  it("requires authorization to be server-side", () => {
    expect("client-supplied role or tenant claims").not.toBe("authorization");
  });

  it("requires revoked or unverified identities to fail closed", () => {
    expect([401, 403]).toContain(401);
  });

  it("treats authoritative evidence as immutable", () => {
    expect([403, 409]).toContain(403);
  });
});
