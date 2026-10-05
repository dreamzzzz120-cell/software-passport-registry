import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');

describe('universal intake storage configuration', () => {
  const route = read('src/routes/universal-intake.ts');
  const worker = read('src/workers/intake-scan-worker.ts');
  const storage = read('src/integrations/intake-storage.ts');

  it('uses the machine broker instead of a Railway-held Supabase service secret', () => {
    expect(route).toContain('createIntakeSignedUpload');
    expect(route).toContain('downloadIntakeObject');
    expect(worker).toContain('downloadIntakeObject');
    expect(route).not.toContain('SUPABASE_SECRET_KEY');
    expect(route).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(worker).not.toContain('SUPABASE_SECRET_KEY');
    expect(worker).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('fails closed when the broker URL or machine token is absent', () => {
    expect(storage).toContain('INTAKE_BROKER_NOT_CONFIGURED');
    expect(storage).toContain('status: 503');
    expect(storage).toContain('SPR_ARTIFACT_BROKER_URL');
    expect(storage).toContain('SPR_ARTIFACT_BROKER_TOKEN');
  });

  it('does not fall back to a public bucket or anon credential', () => {
    expect(storage).not.toMatch(/publicUrl|anon[_ ]?key/i);
    expect(route).not.toMatch(/publicUrl|anon[_ ]?key/i);
  });

  it('keeps environment files out of the image', () => {
    const dockerignore = read('.dockerignore');
    expect(dockerignore).toMatch(/^\.env$/m);
    expect(dockerignore).toMatch(/^\.env\.\*$/m);
  });

  it('documents the broker variables when repository documentation is present', () => {
    if (!fs.existsSync(path.join(root, '.env.example'))) return;
    const example = read('.env.example');
    expect(example).toContain('SPR_ARTIFACT_BROKER_URL');
    expect(example).toContain('SPR_ARTIFACT_BROKER_TOKEN');
  });
  it('serializes intake quota reservation before minting a signed upload URL', () => {
    const transactionAt = route.indexOf('db.transaction(async (tx)');
    const lockAt = route.indexOf('FOR UPDATE');
    const insertAt = route.indexOf('INSERT INTO intake_items');
    const brokerAt = route.indexOf('createIntakeSignedUpload({');
    expect(transactionAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeGreaterThan(transactionAt);
    expect(insertAt).toBeGreaterThan(lockAt);
    expect(brokerAt).toBeGreaterThan(insertAt);
    expect(route).toContain("status <> 'FAILED'");
  });

  it('releases quota when broker signing fails', () => {
    expect(route).toContain("SET status='FAILED'");
    expect(route).toContain("status='AWAITING_UPLOAD'");
    expect(route).toContain('A broker failure must not permanently consume');
  });

});