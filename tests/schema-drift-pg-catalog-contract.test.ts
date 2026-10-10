import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('schema drift audit visibility', () => {
  it('uses pg_catalog so restricted migration roles still see table objects', () => {
    const source = readFileSync('scripts/migrate.ts', 'utf8');
    expect(source).toContain('FROM pg_catalog.pg_class c');
    expect(source).toContain('JOIN pg_catalog.pg_namespace n');
    expect(source).toContain("c.relkind IN ('r', 'p')");
    expect(source).not.toContain('SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()');
  });
});
