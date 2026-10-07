import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

describe('authenticated role resolution', () => {
  it('does not expose the default Viewer role until /api/user/me confirms the current UID', () => {
    expect(source).toContain("const [identityState, setIdentityState] = useState<'loading' | 'ready' | 'error'>('loading')");
    expect(source).toContain("const [role, setRole] = useState('')");
    expect(source).toContain('setIdentityUid(user.uid);');
    expect(source).toContain("identityUid !== user.uid");
    expect(source).toContain('Workspace session temporarily unavailable');
    expect(source).toContain("identityState === 'ready' && !role");
  });
});
