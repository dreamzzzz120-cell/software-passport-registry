import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

describe('authenticated role resolution', () => {
  it('offers retry after identity failure even when the UID has not resolved', () => {
    const errorGate = source.indexOf("if (user && !isPublicPath(path) && identityState === 'error') return <SessionUnavailable");
    const loadingGate = source.indexOf("if (user && !isPublicPath(path) && (identityState === 'loading' || identityUid !== user.uid)) return <AuthLoading");
    expect(errorGate).toBeGreaterThan(-1);
    expect(loadingGate).toBeGreaterThan(errorGate);
  });

  it('does not expose the default Viewer role until /api/user/me confirms the current UID', () => {
    expect(source).toContain("const [identityState, setIdentityState] = useState<'loading' | 'ready' | 'error'>('loading')");
    expect(source).toContain("const [role, setRole] = useState('')");
    expect(source).toContain("identityState === 'ready' && !role");
    expect(source).toContain('setIdentityUid(user.uid);');
    expect(source).toContain("identityUid !== user.uid");
    expect(source).toContain('Workspace session temporarily unavailable');
  });
});
