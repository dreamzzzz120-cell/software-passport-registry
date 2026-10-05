/**
 * Operator-only recovery utility.
 *
 * Provisions an existing, already-authenticated identity into an explicit SPR
 * tenant when the authentication provider contains the user but the SPR
 * membership row is missing. This is intentionally not exposed over HTTP.
 */
import { pool } from '../src/db/index.ts';

function arg(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3).trim();
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

async function main() {
  const uid = arg('uid');
  const email = arg('email').toLowerCase();
  const tenantId = arg('tenant');

  if (!/^[0-9a-f-]{20,64}$/i.test(uid)) throw new Error('Invalid auth uid');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) throw new Error('Invalid email');
  if (!/^tenant-[A-Za-z0-9-]{8,}$/.test(tenantId) || tenantId === 'tenant-default') throw new Error('Invalid tenant id');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const byUid = (await client.query(
      'SELECT id, uid, lower(btrim(email)) AS email, tenant_id, role FROM users WHERE uid = $1 FOR UPDATE',
      [uid],
    )).rows[0];

    const byEmail = (await client.query(
      'SELECT id, uid, lower(btrim(email)) AS email, tenant_id, role FROM users WHERE lower(btrim(email)) = $1 FOR UPDATE',
      [email],
    )).rows[0];

    if (byEmail && byEmail.uid !== uid) {
      throw new Error('Refusing provision: email is already bound to a different auth uid');
    }

    if (byUid) {
      if (byUid.email !== email) throw new Error('Refusing provision: auth uid is already bound to a different email');
      if (byUid.tenant_id !== tenantId) throw new Error('Refusing provision: auth uid already belongs to a different tenant');
      if (byUid.role !== 'Owner') throw new Error('Refusing provision: existing membership is not Owner');
      await client.query(
        `UPDATE users
         SET onboarded = 1,
             company_name = COALESCE(company_name, 'Software Passport Registry Ltd.'),
             role_title = COALESCE(role_title, 'Founder / Owner'),
             display_name = COALESCE(display_name, 'Founder / Owner')
         WHERE uid = $1`,
        [uid],
      );
      await client.query('COMMIT');
      console.log('[Existing Auth Provision] membership already present; profile ensured', tenantId);
      return;
    }

    await client.query(
      `INSERT INTO users
        (uid, email, tenant_id, role, onboarded, invited_by, company_name, role_title, display_name)
       VALUES ($1, $2, $3, 'Owner', 1, 'system:operator-provision',
               'Software Passport Registry Ltd.', 'Founder / Owner', 'Founder / Owner')`,
      [uid, email, tenantId],
    );

    await client.query('COMMIT');
    console.log('[Existing Auth Provision] membership created', tenantId);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('[Existing Auth Provision] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
