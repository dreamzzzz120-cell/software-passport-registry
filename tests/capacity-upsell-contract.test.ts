import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { capacityLimitFrom, capacityMessage } from '../src/lib/capacityLimit.ts';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const limitBody = {
  error: 'ACTIVE_PASSPORT_LIMIT_REACHED',
  billingUnit: 'active_passport',
  activePassports: 12,
  includedActivePassports: 10,
};

describe('recognising the plan ceiling', () => {
  it('reads the counts the server actually reported', () => {
    expect(capacityLimitFrom(409, limitBody)).toMatchObject({ activePassports: 12, includedActivePassports: 10 });
  });

  // A body that merely looks like this on a success would otherwise show an
  // upgrade prompt over an action that worked.
  it('requires the 409 as well as the body', () => {
    expect(capacityLimitFrom(200, limitBody)).toBeNull();
    expect(capacityLimitFrom(201, limitBody)).toBeNull();
    expect(capacityLimitFrom(500, limitBody)).toBeNull();
  });

  it('ignores other 409s, so a duplicate configuration is still an error', () => {
    expect(capacityLimitFrom(409, { error: 'MONITORING_CONFIGURATION_EXISTS' })).toBeNull();
    expect(capacityLimitFrom(409, { error: 'ACTIVE_PASSPORT_LIMIT_REACHED', billingUnit: 'seats' })).toBeNull();
    expect(capacityLimitFrom(409, null)).toBeNull();
    expect(capacityLimitFrom(409, 'nope')).toBeNull();
  });
});

describe('the message distinguishes the two situations behind one status code', () => {
  it('asks an unsubscribed workspace to start a plan', () => {
    const message = capacityMessage({ activePassports: 3, includedActivePassports: 0, subscriptionStatus: 'none' });
    expect(message.cta).toBe('Choose a plan');
    expect(message.detail).toContain('no plan covering them');
  });

  it('asks a subscribed workspace to upgrade, and says existing monitoring is untouched', () => {
    const message = capacityMessage({ activePassports: 12, includedActivePassports: 10 });
    expect(message.cta).toBe('Upgrade plan');
    expect(message.detail).toContain('covers 10 active Passports');
    expect(message.detail).toContain('12 are in use');
    expect(message.detail).toContain('keeps the Passports you already monitor untouched');
  });

  it('gets the singular right, since a plan of one is a real tier', () => {
    expect(capacityMessage({ activePassports: 1, includedActivePassports: 1 }).detail).toContain('covers 1 active Passport ');
  });
});

// The bug this closes: the Active Passport guard (migration 0064) raises P0001,
// but /api/monitoring caught only 23505 and rethrew everything else -- so a
// paying customer hitting their plan ceiling through the UI received a 500 and
// was told their product was broken at the exact moment it should have offered
// them a larger plan.
describe('the server answers the ceiling with a 409, not a 500', () => {
  const route = read('src/routes/monitoring.ts');

  it('recognises the guard exception raised by the database', () => {
    expect(route).toContain('ACTIVE_PASSPORT_LIMIT_REACHED:(\\d+):(\\d+)');
    expect(route).toContain("error: 'ACTIVE_PASSPORT_LIMIT_REACHED'");
    expect(route).toContain('upgradeRequired: true');
  });

  it('reads the message through the Drizzle wrapper as well as the raw error', () => {
    expect(route).toContain('error?.message ?? error?.cause?.message');
  });

  it('answers in the same shape as the other route that enforces this', () => {
    const sibling = read('src/routes/integration-monitoring.ts');
    for (const field of ["billingUnit:'active_passport'", 'upgradeRequired:true']) {
      expect(sibling.replace(/\s/g, ''), field).toContain(field.replace(/\s/g, ''));
    }
    for (const field of ["billingUnit: 'active_passport'", 'upgradeRequired: true']) {
      expect(route, field).toContain(field);
    }
  });

  it('still treats a duplicate configuration as a duplicate', () => {
    expect(route).toContain("return res.status(409).json({ error: 'MONITORING_CONFIGURATION_EXISTS' })");
  });

  it('matches what the database actually raises', () => {
    const migration = read('migrations/0064_active_passport_entitlement_guard.sql');
    expect(migration).toContain("RAISE EXCEPTION 'ACTIVE_PASSPORT_LIMIT_REACHED:%:%'");
  });
});

describe('the view offers an upgrade rather than an error', () => {
  const view = read('src/components/MonitoringView.tsx');

  it('intercepts the limit before the generic error path', () => {
    const intercept = view.indexOf('capacityLimitFrom(response.status, data)');
    const generic = view.indexOf("MONITORING_CONFIGURATION_EXISTS' ?");
    expect(intercept).toBeGreaterThan(-1);
    expect(intercept).toBeLessThan(generic);
  });

  it('renders it as status, not as an error', () => {
    expect(view).toContain('role="status"');
    expect(view).not.toMatch(/capacityLimit[\s\S]{0,200}role="alert"/);
  });

  it('sends the customer to the one screen that can take their money', () => {
    expect(view).toContain('href="/billing"');
  });

  it('shows the real counts rather than a generic ceiling message', () => {
    expect(view).toContain('{capacityLimit.activePassports} active Passport');
    expect(view).toContain('capacityLimit.includedActivePassports > 0');
  });
});
