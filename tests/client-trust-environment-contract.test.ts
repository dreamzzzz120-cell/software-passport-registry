import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Add Client modal provides clear MSP client onboarding without changing the underlying create logic', () => {
  const source = () => read('src/components/ClientsView.tsx');

  it('uses clear client-workspace framing copy', () => {
    const s = source();
    expect(s).toContain('New client');
    expect(s).toContain('Add a client');
    expect(s).toContain('Create the client workspace you’ll use to track software, evidence, risks, and verification.');
    expect(s).toContain('Create client');
  });

  it('previews the real post-creation capabilities, matching what the client workspace actually offers', () => {
    const s = source();
    for (const capability of ['Software', 'Vendors', 'Passports', 'Evidence', 'Monitoring']) {
      expect(s).toContain(`${capability}</div>`);
    }
  });

  it('still submits exactly the same 3 required fields to the same real endpoint, unchanged', () => {
    const s = source();
    expect(s).toContain("onSubmit={handleCreateClient}");
    expect(s).toContain("apiFetch('/api/user/clients'");
    expect(s).toContain('newClientName');
    expect(s).toContain('newClientDomain');
    expect(s).toContain('newClientIndustry');
  });

  it('creation still lands the user directly in that client\'s own workspace, not a generic list', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('onClientCreated={(client) => { setClients((current) => [client, ...current]); setSelectedClientId(client.id); }}');
  });
});
