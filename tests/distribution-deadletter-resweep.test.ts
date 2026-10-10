import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('distribution unsent sweep fail-closed retry guard', () => {
  const source = readFileSync(new URL('../src/workers/distribution-worker.ts', import.meta.url), 'utf8');
  const sql = source.match(/export const UNSENT_CONTACT_SQL = `([^`]+)`;/)?.[1];

  it('never automatically requeues a dead-lettered outreach contact', () => {
    expect(sql).toBeDefined();
    expect(sql).toContain("j.status IN ('queued','running','dead_letter')");
  });

  it('retains actual worker evidence on succeeded jobs while releasing the lease', () => {
    expect(source).toContain("status='succeeded',result=$2::jsonb,last_error=NULL,locked_at=NULL,updated_at=CURRENT_TIMESTAMP");
    expect(source).not.toContain("status='succeeded',result=$2::jsonb,last_error=NULL,locked_at=NULL,locked_by=NULL");
  });

  it('deduplicates the research-to-send handoff against failed send jobs too', () => {
    const handoff = source.match(/async function getContactIdsForSource[\\s\\S]*?async function processJob/)?.[0] ?? '';
    expect(handoff).toContain("j.kind='send_outreach'");
    expect(handoff).toContain("j.status IN ('queued','running','dead_letter')");
  });

  it('still blocks contacts with a sent email or a reserved provider attempt', () => {
    expect(sql).toContain("m.status='sent'");
    expect(sql).toContain("a.status IN ('reserved','unknown','blocked','sent')");
  });
});
