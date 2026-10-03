import serverModule from './vercel-server.cjs';

export const config = { maxDuration: 60 };
const mod = serverModule as any;
export default mod.app ?? mod.default?.app ?? mod.default ?? mod;
