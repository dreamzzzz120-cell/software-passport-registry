import 'express';

declare global {
  namespace Express {
    interface Request {
      sprApi?: {
        id: string;
        tenantId: string;
        name: string;
        scopes: readonly string[];
      };
    }
  }
}

export {};
