import { describe, it, expect } from 'vitest';
import { firstPerCompany } from '../src/routes/distribution.ts';

describe('opportunity queue dedupe', () => {
  it('keeps the first row per URL or lead', () => {
    const rows = [
      { jobId: '1', url: 'https://github.com/jettbrains/-L-', leadId: null },
      { jobId: '2', url: 'https://github.com/jettbrains/-L-/', leadId: null },
      { jobId: '3', url: 'https://sfy.ca/', leadId: null },
      { jobId: '4', url: null, leadId: 'lead_a' },
      { jobId: '5', url: null, leadId: 'lead_a' },
      { jobId: '6', url: null, leadId: null },
    ];
    expect(rows.filter(firstPerCompany()).map((r) => r.jobId)).toEqual(['1', '3', '4', '6']);
  });
});
