import { describe, expect, it } from 'vitest';
import { discussionFromHit } from './social-scout-worker.ts';

const now = new Date('2026-10-10T05:00:00Z');
const recent = Math.floor(now.getTime() / 1000) - 3600;

describe('Social Scout public discussion evidence', () => {
  it('keeps a real relevant discussion with a stable public permalink', () => {
    const item = discussionFromHit(
      { objectID: '123456', title: 'Managed service provider software supply chain security', created_at_i: recent },
      'managed service provider', now,
    );
    expect(item).not.toBeNull();
    expect(item?.url).toBe('https://news.ycombinator.com/item?id=123456');
    expect(item?.relevanceScore).toBeGreaterThanOrEqual(30);
    expect(item?.id).toBe(discussionFromHit(
      { objectID: '123456', title: 'Managed service provider software supply chain security', created_at_i: recent },
      'vendor risk', now,
    )?.id);
  });

  it('rejects irrelevant, stale and malformed results without inventing opportunities', () => {
    expect(discussionFromHit({ objectID: '1', title: 'The best hiking shoes', created_at_i: recent }, 'msp', now)).toBeNull();
    expect(discussionFromHit({ objectID: '2', title: 'SBOM guidance', created_at_i: recent - 9 * 24 * 3600 }, 'sbom', now)).toBeNull();
    expect(discussionFromHit({ objectID: 'not-an-id', title: 'Vendor risk', created_at_i: recent }, 'vendor risk', now)).toBeNull();
  });
});
