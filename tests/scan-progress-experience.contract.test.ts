import { describe, expect, it } from 'vitest';
import { SCAN_STAGES } from '../src/components/ScanProgressExperience';

describe('scan progress experience', () => {
  it('models the complete 21-stage scan pipeline', () => {
    expect(SCAN_STAGES).toHaveLength(21);
    expect(SCAN_STAGES[0]).toBe('Accepting scan request');
    expect(SCAN_STAGES.at(-1)).toBe('Publishing completion result');
  });

  it('does not expose a fake progress stage count', () => {
    expect(new Set(SCAN_STAGES).size).toBe(21);
    expect(SCAN_STAGES.every((stage) => stage.trim().length > 0)).toBe(true);
  });
});
