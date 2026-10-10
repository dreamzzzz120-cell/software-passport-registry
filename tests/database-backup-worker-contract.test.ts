import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('production database backup contract', () => {
  it('uses pg_dump custom format and the dedicated private backup bucket variables', async () => {
    const source = await readFile(path.resolve('src/workers/database-backup-worker.ts'), 'utf8');
    expect(source).toContain("'--format=custom'");
    expect(source).toContain("'--no-owner'");
    expect(source).toContain("'--no-acl'");
    expect(source).toContain("SPR_DB_BACKUP_S3_ENDPOINT");
    expect(source).toContain("SPR_DB_BACKUP_S3_BUCKET");
    expect(source).toContain("SPR_DB_BACKUP_S3_ACCESS_KEY_ID");
    expect(source).toContain("SPR_DB_BACKUP_S3_SECRET_ACCESS_KEY");
  });

  it('fails closed when backup configuration is incomplete and cleans temporary dump files', async () => {
    const source = await readFile(path.resolve('src/workers/database-backup-worker.ts'), 'utf8');
    expect(source).toContain("[DBBackup] not configured; skipping");
    expect(source).toContain("await unlink(file).catch(() => undefined)");
    expect(source).toContain("DB_BACKUP_UPLOAD_FAILED");
    expect(source).toContain("DB_BACKUP_EMPTY");
  });

  it('runs under the existing worker supervisor rather than provisioning another Railway service', async () => {
    const worker = await readFile(path.resolve('worker.ts'), 'utf8');
    expect(worker).toContain("runDatabaseBackupLoop");
    expect(worker).toContain("supervise('database-backup',runDatabaseBackupLoop)");
  });

  it('ships pg_dump in the production worker image', async () => {
    const dockerfile = await readFile(path.resolve('Dockerfile.worker'), 'utf8');
    expect(dockerfile).toContain('postgresql-client');
    expect(dockerfile).toContain('pg_dump --version');
  });
});
