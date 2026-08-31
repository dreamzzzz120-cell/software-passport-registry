import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../middleware/security.ts';
import { requireAuth } from '../middleware/security.ts';

const provisionSchema = z.object({
  name: z.string().trim().min(2).max(120),
}).strict();

/**
 * First-workspace provisioning for an authenticated user who does not yet
 * belong to an organization. Tenant identity is never accepted from request
 * input. The database SECURITY DEFINER function requires app.user_id and
 * performs organization + OWNER membership + legacy tenant projection change
 * atomically.
 */
export function createOrganizationProvisioningRouter() {
  const router = Router();

  router.post('/organization/provision', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = provisionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid organization provisioning request' });

      const suppliedTenantKeys = ['tenantId', 'organizationId', 'workspaceId'].filter((key) => Object.prototype.hasOwnProperty.call(req.body ?? {}, key));
      if (suppliedTenantKeys.length > 0) {
        return res.status(400).json({ error: 'Tenant context is server-derived' });
      }

      const db = req.db!;
      const result = await db.execute(sql`
        SELECT provision_organization(${parsed.data.name}, ${req.user!.id}) AS "organizationId"
      `);
      const organizationId = (result as any).rows?.[0]?.organizationId;
      if (typeof organizationId !== 'string' || organizationId.length < 10) {
        return res.status(500).json({ error: 'Organization provisioning failed' });
      }

      return res.status(201).json({ organizationId, role: 'OWNER' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ORGANIZATION_OWNER_ALREADY_PROVISIONED')) {
        return res.status(409).json({ error: 'User already belongs to an organization' });
      }
      if (message.includes('ORGANIZATION_OWNER_CONTEXT_MISMATCH') || message.includes('ORGANIZATION_OWNER_NOT_FOUND')) {
        return res.status(403).json({ error: 'Organization provisioning is not permitted for this account' });
      }
      if (message.includes('ORGANIZATION_NAME_INVALID')) {
        return res.status(400).json({ error: 'Invalid organization name' });
      }
      return next(error);
    }
  });

  return router;
}
