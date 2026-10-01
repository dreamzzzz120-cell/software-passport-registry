import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('worker database least-privilege contract', () => {
  it('all production worker entrypoints use createWorkerPool instead of opening DATABASE_URL directly', () => {
    const workersDir = path.resolve(__dirname, '..', 'src', 'workers');
    const files = fs.readdirSync(workersDir).filter((name) => name.endsWith('.ts') && name !== 'worker-db.ts');
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(workersDir, file), 'utf8');
      if (/new\s+Pool\s*\(\s*\{[\s\S]{0,500}DATABASE_URL/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('webhook worker is wired to the hardened worker pool', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'workers', 'webhook-worker.ts'), 'utf8');
    expect(source).toContain("import { createWorkerPool } from './worker-db.ts'");
    expect(source).toContain('const pool = createWorkerPool()');
    expect(source).not.toMatch(/new\s+Pool\s*\(\s*\{[\s\S]{0,500}DATABASE_URL/);
  });
});
