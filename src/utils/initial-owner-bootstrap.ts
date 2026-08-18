import crypto from 'crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { auditTrail, users } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';

export type FirebaseUser = {
  uid: string;
  email?: string;
  emailVerified: boolean;
  customClaims?: Record<string, unknown>;
};

export type OwnerBootstrapAuth = {
  getUserByEmail(email: string): Promise<FirebaseUser>;
  setCustomUserClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
};

export type OwnerBootstrapStore = {
  withExclusiveLock<T>(operation: (lockedStore: OwnerBootstrapStore) => Promise<T>): Promise<T>;
  ownerExists(): Promise<boolean>;
  createOrPromoteInitialOwner(input: { uid: string; email: string; tenantId: string }): Promise<void>;
  recordBootstrapAudit(input: { tenantId: string }): Promise<void>;
};

export type OwnerBootstrapInput = {
  initialOwnerEmail?: string;
  bootstrapSecret?: string;
  bootstrapSecretSha256?: string;
};

export class OwnerBootstrapDeniedError extends Error {
  constructor() {
    super('INITIAL_OWNER_BOOTSTRAP_DENIED');
  }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const isExpectedBootstrapSecret = (secret: string | undefined, expectedHash: string | undefined) => {
  if (!secret || !expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actualHash = crypto.createHash('sha256').update(secret).digest();
  const expectedHashBytes = Buffer.from(expectedHash, 'hex');
  return expectedHashBytes.length === actualHash.length && crypto.timingSafeEqual(actualHash, expectedHashBytes);
};

/**
 * Performs the one-time operational initial-Owner bootstrap. This is not an
 * HTTP handler: the caller must be a privileged Cloud Run Job operator, and
 * both bootstrap inputs must be injected server-side from Secret Manager.
 */
export async function bootstrapInitialOwner(
  input: OwnerBootstrapInput,
  auth: OwnerBootstrapAuth,
  store: OwnerBootstrapStore,
): Promise<{ tenantId: string }> {
  const configuredEmail = input.initialOwnerEmail ? normalizeEmail(input.initialOwnerEmail) : '';
  if (!configuredEmail || !isExpectedBootstrapSecret(input.bootstrapSecret, input.bootstrapSecretSha256)) {
    throw new OwnerBootstrapDeniedError();
  }

  let firebaseUser: FirebaseUser;
  try {
    firebaseUser = await auth.getUserByEmail(configuredEmail);
  } catch {
    throw new OwnerBootstrapDeniedError();
  }

  if (
    !firebaseUser.emailVerified ||
    !firebaseUser.email ||
    normalizeEmail(firebaseUser.email) !== configuredEmail
  ) {
    throw new OwnerBootstrapDeniedError();
  }

  const previousClaims = firebaseUser.customClaims ?? {};
  let claimsChanged = false;

  try {
    return await store.withExclusiveLock(async (lockedStore) => {
      if (await lockedStore.ownerExists()) throw new OwnerBootstrapDeniedError();

      const tenantId = `tenant-${crypto.randomUUID()}`;
      // Claims alone never authorize access: requireAuth checks the persisted
      // user role and tenant on every request before accepting these claims.
      await auth.setCustomUserClaims(firebaseUser.uid, {
        workspaceId: tenantId,
        tenantId,
        role: 'Owner',
      });
      claimsChanged = true;

      await lockedStore.createOrPromoteInitialOwner({
        uid: firebaseUser.uid,
        email: configuredEmail,
        tenantId,
      });
      await lockedStore.recordBootstrapAudit({ tenantId });
      return { tenantId };
    });
  } catch (error) {
    if (claimsChanged) {
      try {
        await auth.setCustomUserClaims(firebaseUser.uid, previousClaims);
      } catch (rollbackError) {
        console.error('[Initial Owner Bootstrap] Firebase claim rollback failed', rollbackError);
      }
    }
    if (error instanceof OwnerBootstrapDeniedError) throw error;
    console.error('[Initial Owner Bootstrap] Failed', error);
    throw new OwnerBootstrapDeniedError();
  }
}

function createProductionStoreFor(executor: any): OwnerBootstrapStore {
  return {
    async withExclusiveLock<T>(operation: (lockedStore: OwnerBootstrapStore) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('spr-initial-owner-bootstrap-v1'))`);
        return operation(createProductionStoreFor(tx));
      });
    },
    async ownerExists() {
      const owner = await executor.select({ id: users.id }).from(users).where(eq(users.role, 'Owner')).limit(1);
      return owner.length > 0;
    },
    async createOrPromoteInitialOwner({ uid, email, tenantId }) {
      const existing = await executor.select().from(users).where(eq(users.uid, uid)).limit(1);
      if (existing[0]) {
        await executor.update(users)
          .set({
            email,
            tenantId,
            role: 'Owner',
            onboarded: 1,
            invitedBy: 'system:initial-owner-bootstrap',
          })
          .where(eq(users.uid, uid));
        return;
      }
      await executor.insert(users).values({
        uid,
        email,
        tenantId,
        role: 'Owner',
        onboarded: 1,
        invitedBy: 'system:initial-owner-bootstrap',
      });
    },
    async recordBootstrapAudit({ tenantId }) {
      const lastBlock = await executor.select()
        .from(auditTrail)
        .where(eq(auditTrail.tenantId, tenantId))
        .orderBy(desc(auditTrail.id))
        .limit(1)
        .then((rows) => rows[0]);
      const timestamp = new Date().toISOString();
      const action = 'Initial Owner Bootstrap';
      const actor = 'system:initial-owner-bootstrap';
      const payload = JSON.stringify({ outcome: 'success', mechanism: 'controlled-operational-bootstrap' });
      const previousHash = lastBlock?.currentHash ?? '0000000000000000000000000000000000000000000000000000000000000000';
      const currentHash = crypto.createHash('sha256')
        .update(action + timestamp + actor + payload + previousHash)
        .digest('hex');
      await executor.insert(auditTrail).values({ tenantId, action, timestamp, actor, payload, previousHash, currentHash });
    },
  };
}

export async function runProductionInitialOwnerBootstrap(): Promise<void> {
  await bootstrapInitialOwner(
    {
      initialOwnerEmail: config.ownerBootstrap.initialOwnerEmail,
      bootstrapSecret: config.ownerBootstrap.secret,
      bootstrapSecretSha256: config.ownerBootstrap.secretSha256,
    },
    {
      getUserByEmail: (email) => adminAuth.getUserByEmail(email),
      setCustomUserClaims: (uid, claims) => adminAuth.setCustomUserClaims(uid, claims),
    },
    createProductionStoreFor(db),
  );
  console.info('[Initial Owner Bootstrap] Completed and permanently locked by the persisted Owner record.');
}
