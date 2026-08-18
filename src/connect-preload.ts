import express from 'express';
import { createConnectRouter } from './routes/connect.ts';
import { createPublicConnectRouter } from './routes/public-connect.ts';

const originalUse = express.application.use;
let mounted = false;

express.application.use = function patchedUse(this: any, ...args: any[]) {
  const result = originalUse.apply(this, args as any);
  const path = typeof args[0] === 'string' ? args[0] : null;
  if (!mounted && path === '/api') {
    const candidate = args[1];
    const looksLikeRouter = typeof candidate === 'function' && candidate.stack;
    if (looksLikeRouter) {
      mounted = true;
      this.use('/api', createPublicConnectRouter());
      this.use('/api', createConnectRouter());
    }
  }
  return result;
};
