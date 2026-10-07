import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('agent security evidence layer contracts', () => {
  it('keeps declared AI inventory separate from independently observed agent evidence', () => {
    const migration = read('migrations/0133_agent_security_evidence_layer.sql');
    expect(migration).toContain('Declared ai_systems remain self-reported');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS agent_assets');
    expect(migration).toContain("verification_state text NOT NULL DEFAULT 'OBSERVED'");
  });

  it('preserves tenant isolation across every new table', () => {
    const migration = read('migrations/0133_agent_security_evidence_layer.sql');
    expect(migration).toContain("ARRAY['agent_assets','agent_capabilities','agent_relationships','agent_security_events']");
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain("current_setting(''app.tenant_id'', true)");
  });

  it('models threat indicators separately from execution outcomes', () => {
    const migration = read('migrations/0133_agent_security_evidence_layer.sql');
    expect(migration).toContain("'prompt_injection_indicator'");
    expect(migration).toContain("'dangerous_tool_chain'");
    expect(migration).toContain("'execution_receipt'");
    expect(migration).toContain("'NOT_OBSERVED'");
    expect(migration).toContain("'UNKNOWN'");
  });

  it('requires evidence hashes for observed assets and capabilities', () => {
    const migration = read('migrations/0133_agent_security_evidence_layer.sql');
    expect((migration.match(/evidence_hash text NOT NULL/g) || []).length).toBeGreaterThanOrEqual(3);
    const route = read('src/routes/agent-security.ts');
    expect(route).toContain('evidenceHash: z.string().trim().min(16)');
  });

  it('mounts the capability inside authenticated SPR rather than exposing a second public product', () => {
    const server = read('server.ts');
    expect(server).toContain("app.use('/api/agent-security', requireAuth, createAgentSecurityRouter());");
  });

  it('keeps all API reads and event attachment tenant-scoped', () => {
    const route = read('src/routes/agent-security.ts');
    expect(route).toContain('WHERE a.tenant_id=');
    expect(route).toContain('AND tenant_id=');
    expect(route).toContain("AGENT_ASSET_NOT_FOUND");
  });

  it('surfaces observed security inside the existing AI Trust Center', () => {
    const view = read('src/components/AITrustCenterView.tsx');
    expect(view).toContain("apiFetch('/api/agent-security/summary')");
    expect(view).toContain('Observed agent security');
    expect(view).toContain('Observed evidence is kept separate from declared AI inventory');
  });
});
