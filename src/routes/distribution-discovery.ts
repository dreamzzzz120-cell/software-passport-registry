import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { appPool } from '../db/index.ts';
import { requireAuth, requireFounder, requireRole, type AuthenticatedRequest } from '../middleware/security.ts';
import { buildMspDiscoveryQueries, canonicalizeDomain, type DiscoveryProvider } from '../lib/distribution-discovery.ts';

const limiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });
const schema = z.object({ provider: z.string().trim().min(1).max(100), query: z.string().trim().min(2).max(200), limit: z.number().int().min(1).max(50).optional() }).strict();

function configuredProvider(name: string): DiscoveryProvider {
  throw new Error(`DISTRIBUTION_DISCOVERY_PROVIDER_NOT_CONFIGURED:${name}`);
}

export function createDistributionDiscoveryRouter() {
  const router = Router();
  const founderOnly = [requireAuth, requireRole('Owner'), requireFounder, limiter];

  router.get('/founder/distribution/discovery/queries', ...founderOnly, (_req: AuthenticatedRequest, res) => {
    return res.json({ queries: buildMspDiscoveryQueries(), evidencePolicy: 'Queries are discovery prompts, not evidence that a company is an MSP.' });
  });

  router.post('/founder/distribution/discovery/test-domain', ...founderOnly, async (req: AuthenticatedRequest, res) => {
    try {
      const value = z.object({ url: z.string().url().max(2048) }).strict().parse(req.body);
      return res.json({ domain: canonicalizeDomain(value.url), observedAt: new Date().toISOString() });
    } catch {
      return res.status(400).json({ error: 'A valid HTTP(S) URL is required.' });
    }
  });

  router.post('/founder/distribution/discovery/run', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = schema.parse(req.body);
      const provider = configuredProvider(input.provider);
      const results = await provider.discover(input.query, input.limit ?? 25);
      return res.json({ provider: input.provider, query: input.query, results, observedAt: new Date().toISOString() });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid discovery request.' });
      return next(error);
    }
  });

  return router;
}
