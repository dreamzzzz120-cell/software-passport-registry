import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Real production bug, found via an adversarial RBAC test: DELETE FROM users
// (routes/auth.ts's "remove team member") cascades to login_history, but
// spr_login_history_integrity unconditionally rejected every DELETE/UPDATE,
// so the cascade always aborted the whole removal for any member who had
// ever logged in (recordSession runs on every authenticated request, so
// this was effectively always). Confirmed live: removing a freshly-created
// test user with zero login_history rows worked; the moment that user made
// one authenticated request, removal started failing with
// LOGIN_HISTORY_IMMUTABLE.
describe('login_history survives its user being removed', () => {
  const migration = () => read('migrations/0034_login_history_survives_user_removal.sql');

  it('makes user_id nullable and switches the FK from CASCADE to SET NULL', () => {
    const m = migration();
    expect(m).toContain('ALTER TABLE login_history ALTER COLUMN user_id DROP NOT NULL;');
    expect(m).toContain('FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;');
  });

  it('still rejects every DELETE on login_history unconditionally', () => {
    const m = migration();
    expect(m).toMatch(/IF TG_OP = 'DELETE' THEN\s*RAISE EXCEPTION 'LOGIN_HISTORY_IMMUTABLE';/);
  });

  it('carves out only the exact SET NULL transition, leaving every other column check intact', () => {
    const m = migration();
    expect(m).toContain('NEW.user_id IS NULL AND OLD.user_id IS NOT NULL');
    expect(m).toContain('AND NEW.id = OLD.id AND NEW.tenant_id = OLD.tenant_id');
    expect(m).toContain('AND NEW.occurred_at = OLD.occurred_at AND NEW.ip = OLD.ip');
    expect(m).toContain('AND NEW.user_agent = OLD.user_agent AND NEW.status = OLD.status');
  });

  it('still rejects every other UPDATE (e.g. tampering with ip/status/occurred_at)', () => {
    const m = migration();
    expect(m).toMatch(/RETURN NEW;\s*END IF;\s*RAISE EXCEPTION 'LOGIN_HISTORY_IMMUTABLE';\s*END IF;/);
  });

  it('leaves the tenant-ownership check on INSERT unchanged', () => {
    const m = migration();
    expect(m).toContain("RAISE EXCEPTION 'Login history entry does not belong to the referenced user''s tenant';");
  });
});
