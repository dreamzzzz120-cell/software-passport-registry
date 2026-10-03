process.env.SPR_SKIP_AUTOSTART = 'true';

const { app } = await import('../server.ts');

export const config = {
  maxDuration: 60,
};

export default app;
