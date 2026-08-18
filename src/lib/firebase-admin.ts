/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from '../config.ts';

function loadAdminCredential() {
  if (config.firebase.serviceAccountKey) {
    try {
      const payload = JSON.parse(config.firebase.serviceAccountKey) as ServiceAccount;
      return cert(payload);
    } catch (err) {
      console.warn('[Firebase Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', err);
    }
  }

  if (config.firebase.googleApplicationCredentials) {
    return cert(config.firebase.googleApplicationCredentials as ServiceAccount);
  }

  return undefined;
}

const adminOptions: { projectId?: string; credential?: ReturnType<typeof cert> } = {};
const credential = loadAdminCredential();
if (credential) adminOptions.credential = credential;
if (config.firebase.projectId) adminOptions.projectId = config.firebase.projectId;

const app = getApps().length === 0 ? initializeApp(adminOptions) : getApp();
export const adminAuth = getAuth(app);

export async function setUserCustomClaims(
  uid: string,
  claims: { workspaceId: string; role: string },
): Promise<{ success: boolean; reason?: string }> {
  try {
    const expectedClaims = {
      workspaceId: claims.workspaceId,
      tenantId: claims.workspaceId,
      role: claims.role,
    };
    await adminAuth.setCustomUserClaims(uid, expectedClaims);
    const updatedUser = await adminAuth.getUser(uid);
    const actualClaims = updatedUser.customClaims || {};
    if (
      actualClaims.workspaceId !== expectedClaims.workspaceId ||
      actualClaims.tenantId !== expectedClaims.tenantId ||
      actualClaims.role !== expectedClaims.role
    ) {
      return { success: false, reason: 'Firebase custom-claim read-back did not match the requested assignment' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, reason: err?.message || String(err) };
  }
}
