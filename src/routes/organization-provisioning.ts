import type { Request, Response } from "express";

/**
 * Hardened organization provisioning contract.
 *
 * Tenant identity is derived from the authenticated principal and the
 * database transaction; callers never supply tenantId/organizationId.
 * The route adapter should invoke the existing DB provision_organization()
 * function inside the authenticated request context.
 */
export type ProvisionOrganizationInput = {
  name: string;
};

export function validateProvisionOrganizationInput(input: unknown): ProvisionOrganizationInput {
  if (!input || typeof input !== "object") {
    throw new Error("invalid_request");
  }
  const value = input as Record<string, unknown>;
  if ("tenantId" in value || "organizationId" in value || "workspaceId" in value) {
    throw new Error("tenant_context_is_server_derived");
  }
  if (typeof value.name !== "string") {
    throw new Error("invalid_organization_name");
  }
  const name = value.name.trim();
  if (name.length < 1 || name.length > 200) {
    throw new Error("invalid_organization_name");
  }
  return { name };
}

/**
 * Route factory kept deliberately dependency-injected so the existing auth,
 * DB and error-handling infrastructure remains authoritative.
 */
export function createProvisionOrganizationHandler(deps: {
  requireAuth: (req: Request, res: Response, next: () => void) => void;
  provision: (req: Request, name: string) => Promise<unknown>;
}) {
  return async (req: Request, res: Response) => {
    try {
      validateProvisionOrganizationInput(req.body);
      const { name } = validateProvisionOrganizationInput(req.body);
      const organization = await deps.provision(req, name);
      return res.status(201).json({ organization });
    } catch (error) {
      const message = error instanceof Error ? error.message : "provisioning_failed";
      if (message === "tenant_context_is_server_derived") {
        return res.status(400).json({ error: message });
      }
      if (message === "invalid_request" || message === "invalid_organization_name") {
        return res.status(400).json({ error: message });
      }
      return res.status(403).json({ error: "organization_provisioning_denied" });
    }
  };
}
