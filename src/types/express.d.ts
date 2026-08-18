import 'express';
import 'express-serve-static-core';

type SprApiContext = {
  id: string;
  tenantId: string;
  name: string;
  scopes: readonly string[];
};

declare module 'express-serve-static-core' {
  interface Request {
    sprApi?: SprApiContext;
  }
}

declare global {
  namespace Express {
    interface Request {
      sprApi?: SprApiContext;
    }
  }
}

export {}; 
