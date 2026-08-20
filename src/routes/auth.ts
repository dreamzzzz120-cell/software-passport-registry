/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { AuthenticatedRequest, requireAuth } from '../middleware/security.ts';

export function createAuthRouter() {
  const router = Router();

  // The Firebase ID token is the sole authentication authority. The database
  // record supplies the tenant/RBAC projection after token verification.
  router.get('/user/me', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = await db.select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        tenantId: users.tenantId,
        role: users.role,
        companyName: users.companyName,
        roleTitle: users.roleTitle,
        numTechnicians: users.numTechnicians,
        clientCount: users.clientCount,
        primaryUseCase: users.primaryUseCase,
        onboarded: users.onboarded,
        mfaEnabled: users.mfaEnabled,
        createdAt: users.createdAt,
      }).from(users).where(eq(users.uid, req.user!.uid)).then(rows => rows[0]);

      if (!user) return res.status(403).json({ error: 'User account is not provisioned' });
      return res.json({ ...user, emailVerified: req.user!.emailVerified });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/auth/verify-status', requireAuth, async (req: AuthenticatedRequest, res) => {
    return res.json({ verified: req.user!.emailVerified, emailVerified: req.user!.emailVerified });
  });

  return router;
}
