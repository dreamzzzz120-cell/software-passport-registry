const TENANT_KEYS = ["tenantId", "organizationId", "workspaceId"] as const;

/** Reject tenant selectors from untrusted request payloads. */
export function assertNoClientTenantSelector(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of TENANT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error("tenant_context_is_server_derived");
    }
  }
}

export function assertTenantPathDoesNotOverrideAuthenticatedContext(
  authenticatedTenantId: string,
  requestedTenantId: string | undefined,
): void {
  if (requestedTenantId !== undefined && requestedTenantId !== authenticatedTenantId) {
    throw new Error("tenant_context_is_server_derived");
  }
}
