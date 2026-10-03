process.env.SPR_SKIP_AUTOSTART = 'true';
process.env.SPR_API_ONLY = 'true';

import { app } from '../server.ts';

export const config = {
  maxDuration: 60,
};

export default app;
