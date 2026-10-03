import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('intake scanner hostile-input cleanup contract', () => {
  it('always removes the per-job temporary directory and records cleanup outcome', async () => {
    const source = await readFile(path.resolve('src/workers/intake-scan-worker.ts'), 'utf8');
    expect(source).toContain("const tempRoot = await mkdtemp(path.join(os.tmpdir(), `spr-intake-${job.id}-`))");
    expect(source).toMatch(/finally\s*\{[\s\S]*?rm\(tempRoot, \{ recursive: true, force: true \}\)/);
    expect(source).toContain('temporary_directory_removed=$2');
  });

  it('discards an extracted tree when post-extraction limits are exceeded', async () => {
    const source = await readFile(path.resolve('src/workers/intake-scan-worker.ts'), 'utf8');
    expect(source).toContain("throw new Error('ARCHIVE_FILE_LIMIT_EXCEEDED')");
    expect(source).toContain("throw new Error('ARCHIVE_EXPANSION_LIMIT_EXCEEDED')");
    expect(source).toMatch(/catch \(error\) \{ entry\.archiveEnumerated = false; await rm\(extractDir, \{ recursive: true, force: true \}\)/);
  });

  it('does not follow extracted symlinks during the post-extraction walk', async () => {
    const source = await readFile(path.resolve('src/workers/intake-scan-worker.ts'), 'utf8');
    expect(source).toContain("if (entry.isSymbolicLink()) { symlinks++; continue; }");
  });
});
