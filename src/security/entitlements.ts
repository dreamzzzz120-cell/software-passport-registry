import { sql } from 'drizzle-orm';
import type { Response, Request } from 'express';
import type { ScopedDb } from '../middleware/tenant-scope.ts';

export type Capability = 'workspace' | 'passport' | 'sbom' | 'monitoring' | 'vendor_risk' | 'governance' | 'msp' | 'white_label' | 'bulk_export' | 'api' | 'enterprise_controls';

const PATH_CAPABILITIES: Array<{ capability: Capability; test: (path: string) => boolean }> = [
  { capability: 'bulk_export', test: p => p.includes('/export') },
  { capability: 'vendor_risk', test: p => p.includes('/vendors') },
  { capability: 'governance', test: p => p.includes('/governance') || p.includes('/privacy') || p.includes('/compliance') },
  { capability: 'msp', test: p => p.includes('/msp') },
  { capability: 'monitoring', test: p => p.includes('/monitoring') || p.includes('/integration-monitoring') },
  { capability: 'api', test: p => p.includes('/agent/v1') || p === '/api/connect' || p.includes('/api/integrations') },
  { capability: 'enterprise_controls', test: p => p.includes('/tenant') || p.includes('/organization') },
  { capability: 'sbom', test: p => p.includes('/scan') || p.includes('/sbom') },
  { capability: 'passport', test: p => p.includes('/passport') || p.includes('/trust-loop') },
];

export function capabilityForPath(req: Request): Capability {
  const path = `${req.baseUrl}${req.path}`.toLowerCase();
  return PATH_CAPABILITIES.find(item => item.test(path))?.capability ?? 'workspace';
}

export async function tenantHasCapability(db: ScopedDb, tenantId: string, capability: Capability): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM plan_capabilities pc
      JOIN tenant_subscriptions ts ON ts.plan = pc.plan
      WHERE ts.tenant_id = ${tenantId}
        AND pc.capability = ${capability}
        AND pc.enabled = true
        AND ts.status IN ('active','trialing')
    ) AS allowed
  `);
  return Boolean((result as any).rows?.[0]?.allowed);
}

export async function enforceCapability(req: { user?: { tenantId: string }; db?: ScopedDb }, res: Response, capability: Capability): Promise<boolean> {
  if (!req.user?.tenantId || !req.db) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    return false;
  }
  if (await tenantHasCapability(req.db, req.user.tenantId, capability)) return true;
  res.status(402).json({ error: 'CAPABILITY_NOT_INCLUDED', code: 'CAPABILITY_NOT_INCLUDED', capability, message: `The active SPR plan does not include the ${capability.replaceAll('_', ' ')} capability.`, billingPath: '/billing' });
  return false;
}

export const PLAN_CAPABILITY_MATRIX: Record<string, Capability[]> = {
  pilot: ['workspace','passport','sbom','vendor_risk','governance','msp','white_label','bulk_export'],
  starter: ['workspace','passport','sbom'],
  professional: ['workspace','passport','sbom','monitoring','vendor_risk','governance','bulk_export'],
  growth: ['workspace','passport','sbom','monitoring','vendor_risk','governance','msp','white_label','bulk_export','api'],
  enterprise: ['workspace','passport','sbom','monitoring','vendor_risk','governance','msp','white_label','bulk_export','api','enterprise_controls'],
};
