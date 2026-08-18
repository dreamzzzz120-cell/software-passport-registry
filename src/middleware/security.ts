export const rateLimiter = async (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const tenantId = (req as AuthenticatedRequest).user?.tenantId;
  const key = tenantId ? `rl:tenant:${tenantId}:ip:${ip}` : `rl:ip:${ip}`;
  try {
    const counter = await sharedStore.incr(key, rateLimitWindowMs, maxRequestsPerWindow);
    res.setHeader('X-RateLimit-Limit', String(maxRequestsPerWindow));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequestsPerWindow - counter.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(counter.resetAt / 1000)));
    if (counter.count > maxRequestsPerWindow) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((counter.resetAt - Date.now()) / 1000))));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } });
    }
    return next();
  } catch (err) {
    const requestId = randomUUID();
    console.error('[RateLimiter] fail-closed (requestId=%s): %s', requestId, err instanceof Error ? err.message : String(err));
    return res.status(503).json({ error: { code: 'RATE_LIMIT_STORE_UNAVAILABLE', message: 'This operation is temporarily unavailable.', requestId } });
  }
};
