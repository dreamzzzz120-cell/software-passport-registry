import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR evidence explorer contracts', () => {
  it('consumes the previously orphaned tenant-scoped ledger endpoint instead of a new, unaudited one', () => {
    const explorer = read('src/components/EvidenceExplorerView.tsx');
    expect(explorer).toContain("apiFetch(`/api/trust-loop/ledger/${encodeURIComponent(passportId)}`)");
  });

  it('renders the full claim-to-evidence chain: source, timestamp, hash, and does not invent a fabricated per-claim confidence score', () => {
    const explorer = read('src/components/EvidenceExplorerView.tsx');
    expect(explorer).toContain('Source');
    expect(explorer).toContain('Timestamp');
    expect(explorer).toContain('evidence_hash');
    expect(explorer).toContain('does not assign a per-claim confidence score');
    expect(explorer).toContain('evidence completeness');
  });

  it('derives claim history from observations that actually reference the finding, not all observations', () => {
    const explorer = read('src/components/EvidenceExplorerView.tsx');
    expect(explorer).toContain('parseIds(obs.finding_ids).includes(selectedFinding.id)');
  });

  it('is reachable from navigation and the dashboard, not orphaned like the backend endpoint was', () => {
    const commandCenter = read('src/components/CommandCenter.tsx');
    expect(commandCenter).toContain("path: '/evidence-explorer'");
    const app = read('src/App.tsx');
    expect(app).toContain("case '/evidence-explorer':");
    const dashboard = read('src/components/EvidenceDashboardView.tsx');
    expect(dashboard).toContain("onNavigateTab('/evidence-explorer')");
  });
});
