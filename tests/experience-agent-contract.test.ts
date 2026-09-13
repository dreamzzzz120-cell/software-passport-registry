import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routeSource = fs.readFileSync(path.join(root, 'src/routes/agent-api.ts'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'src/components/ExperienceAgent.tsx'), 'utf8');

describe('Experience Agent safety contract', () => {
  it('requires authentication at the router boundary', () => {
    expect(routeSource).toContain('router.use(requireAuth);');
  });

  it('validates commands with a strict bounded schema', () => {
    expect(routeSource).toMatch(/const commandInput = z\.object\(\{ input: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(500\)/);
    expect(routeSource).toContain('.strict()');
  });

  it('keeps every workspace query tenant-scoped', () => {
    const queryBlocks = routeSource.match(/db\.execute\(sql`[\s\S]*?`\)/g) ?? [];
    expect(queryBlocks.length).toBeGreaterThan(0);
    for (const query of queryBlocks) {
      expect(query).toContain('tenant_id=');
    }
  });

  it('does not expose arbitrary SQL, URLs, or tool execution from user input', () => {
    expect(routeSource).not.toMatch(/\b(req\.body|parsed\.data\.input)\s*\.?(sql|query|url|endpoint)\b/);
    expect(routeSource).not.toContain('db.execute(sql.raw');
    expect(routeSource).not.toContain('eval(');
    expect(routeSource).not.toContain('new Function(');
  });

  it('keeps the command surface read-only', () => {
    const commandSection = routeSource.split("router.post('/command'")[1]?.split("router.post('/verify-software'")[0] ?? '';
    expect(commandSection).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  });

  it('never treats UNKNOWN as a positive trust decision', () => {
    expect(routeSource).toContain("status: 'UNKNOWN'");
    expect(routeSource).toContain('No trust claim');
    expect(uiSource).toContain('No negative trust claim was made.');
    expect(uiSource).toContain('No trust claim was made.');
  });

  it('keeps the agent UI lazy-loaded so it is not added to the initial application bundle', () => {
    const mainSource = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
    expect(mainSource).toContain("lazy(() => import('./components/ExperienceAgent'))");
  });

  it('only allows fixed internal navigation targets', () => {
    const allowed = ['/dashboard', '/clients', '/passports', '/vendors', '/monitoring', '/compliance', '/reports', '/billing', '/settings'];
    for (const route of allowed) expect(routeSource).toContain(`'${route}'`);
    expect(routeSource).not.toMatch(/path:\s*input/);
  });
});
