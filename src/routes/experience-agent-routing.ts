import type { Router } from 'express';

const LEGACY_POST_PATHS = new Set([
  '/command', '/receipts/confirmation', '/receipts/outcome',
  '/verify-software', '/verify-passport', '/vendor-risk',
  '/revenue-opportunities', '/verify-claim',
]);

/** Route the current UI separately while supporting already-deployed clients. */
export function mountExperienceAgentRoutes(app: Pick<Router, 'use'>, agent: Router): void {
  app.use('/api/experience-agent/v1', agent);
  app.use('/api/agent/v1', (req, res, next) => {
    const path = req.path.replace(/\/+$/, '') || '/';
    const legacyOperation = (req.method === 'POST' && LEGACY_POST_PATHS.has(path))
      || (req.method === 'GET' && /^\/passport\/[^/]+$/.test(path));
    // A supplied API key always stays on the machine API, including malformed
    // or empty keys. The compatibility mount never grants authentication.
    if (!legacyOperation || req.headers['x-api-key'] !== undefined
      || !req.headers.authorization?.startsWith('Bearer ')) return next();
    return agent(req, res, next);
  });
}
