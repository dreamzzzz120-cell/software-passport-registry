import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
describe('traffic conversion event migration', () => {
  it('upgrades the old constraint without losing rows and accepts every API event', async () => {
    const db = new PGlite();
    try {
      const old = readFileSync('migrations/0126_growth_platform.sql', 'utf8');
      const oldEvents = old.match(/CHECK \(event_name IN \(([\s\S]*?)\)\)/)![1];
      await db.exec(`CREATE TABLE traffic_events (event_name text NOT NULL, CONSTRAINT traffic_events_event_name_check CHECK (event_name IN (${oldEvents}))); INSERT INTO traffic_events VALUES ('page_view');`);
      await expect(db.query("INSERT INTO traffic_events VALUES ('report_viewed')")).rejects.toThrow();
      const migration = readFileSync('migrations/0144_traffic_conversion_event_names.sql', 'utf8');
      await db.exec(migration);
      await db.exec(migration);
      const api = readFileSync('src/routes/traffic.ts', 'utf8');
      const events = Array.from(api.match(/const eventNames = \[([^\]]+)\]/)![1].matchAll(/'([^']+)'/g), m => m[1]);
      for (const event of events) await db.query('INSERT INTO traffic_events VALUES ($1)', [event]);
      expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM traffic_events')).rows[0].count).toBe(events.length + 1);
      await expect(db.query("INSERT INTO traffic_events VALUES ('unrecognized')")).rejects.toThrow();
    } finally { await db.close(); }
  });
});
