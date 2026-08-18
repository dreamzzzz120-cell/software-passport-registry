import type { AuthenticatedRequest } from '../middleware/security';

declare global {
  namespace Express {
    interface Request {
      sprApi?: {
        id: string;
        tenantId: string;
        name: string;
        scopes: string[];
      };
    }
  }
}

export {};
