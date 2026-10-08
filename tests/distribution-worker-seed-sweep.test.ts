import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ queued: [] as Array<{url:string;origin:any}>, locked:false }));
vi.mock('../src/lib/distribution-engine.ts', async original => ({
  ...await original<any>(),
  enqueueResearchUrl: async (_pool:any,url:string,origin:any) => { state.queued.push({url,origin}); return 'job'; },
}));
import { sweepDiscovery } from '../src/workers/distribution-worker.ts';
const env = { ...process.env };
const pool = {
  async connect() {
    return {
      async query(text:string) {
        if (/pg_try_advisory_lock/.test(text)) {
          if (state.locked) return { rows:[{locked:false}] };
          state.locked=true; return { rows:[{locked:true}] };
        }
        if (/pg_advisory_unlock/.test(text)) { state.locked=false; return {rows:[]}; }
        if (/SELECT discovery_enabled/.test(text)) return {rows:[{discovery_enabled:true,outreach_enabled:false}]};
        if (/SELECT DISTINCT payload/.test(text)) return {rows:state.queued.map(q=>({url:q.url}))};
        return {rows:[]};
      },
      release() {},
    };
  },
};
beforeEach(() => {
  state.queued=[]; state.locked=false;
  process.env.DISTRIBUTION_AUTONOMOUS_DISCOVERY='true';
  for(const k of ['GOOGLE_PLACES_API_KEY','BRAVE_SEARCH_API_KEY','DISTRIBUTION_DISCOVERY_PROVIDER_URL','DISTRIBUTION_DISCOVERY_EXTRA_SEED_URLS']) delete process.env[k];
  process.env.DISTRIBUTION_DISCOVERY_SEED_URLS=Array.from({length:2000},(_,i)=>`https://msp-${i}.example.test/`).join('\n');
});
afterEach(() => { for(const k of Object.keys(process.env)) if(!(k in env)) delete process.env[k]; Object.assign(process.env,env); });

describe('worker seed-list sweeps', () => {
  it('queues all 2,000 candidates with their origin and skips them on repetition', async () => {
    expect(await sweepDiscovery(pool as any)).toBe(2000);
    expect(state.queued).toHaveLength(2000);
    expect(state.queued.every(q=>q.origin.kind==='discovery_sweep' && q.origin.query==='seed-list')).toBe(true);
    expect(await sweepDiscovery(pool as any)).toBe(0);
    expect(state.locked).toBe(false);
  });
  it('allows only one concurrent sweep to queue the feed', async () => {
    const counts=await Promise.all([sweepDiscovery(pool as any),sweepDiscovery(pool as any)]);
    expect(counts.sort((a,b)=>a-b)).toEqual([0,2000]);
    expect(state.queued).toHaveLength(2000);
  });
  it('does not discover when disabled', async () => {
    process.env.DISTRIBUTION_AUTONOMOUS_DISCOVERY='false';
    expect(await sweepDiscovery(pool as any)).toBe(0);
    expect(state.queued).toHaveLength(0);
  });
});
