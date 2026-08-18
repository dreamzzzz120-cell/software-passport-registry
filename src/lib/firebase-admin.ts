/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp, cert, applicationDefault, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from '../config.ts';

function loadAdminCredential() {
  if (config.firebase.serviceAccountKey) {
    try {
      const payload = JSON.parse(config.firebase.serviceAccountKey) as ServiceAccount;
      if (!payload.projectId || !payload.clientEmail || !payload.privateKey) throw new Error('Service account is missing required fields');
      return cert(payload);
    } catch (error) {
      if (config.isProduction) throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_KEY: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[Firebase Admin] Invalid service account; development startup will use application default credentials when available.');
    }
  }

  if (config.firebase.googleApplicationCredentials) {
    return applicationDefault();
  }

  if (config.isProduction) throw new Error('Firebase Admin credentials are required in production.');
  return undefined;
}

const adminOptions: { projectId?: string; credential?: ReturnType<typeof cert> | ReturnType<typeof applicationDefault> } = {};
const credential = loadAdminCredential();
if (credential) adminOptions.credential = credential;
if (config.firebase.projectId) adminOptions.projectId = config.firebase.projectId;

const app = getApps().length === 0 ? initializeApp(adminOptions) : getApp();
export const adminAuth = getAuth(app);

export async function setUserCustomClaims(uid: string, claims: { workspaceId: string; role: string }): Promise<{ success: boolean; reason?: string }> {
  try {
    const expectedClaims = { workspaceId: claims.workspaceId, tenantId: claims.workspaceId, role: claims.role };
    await adminAuth.setCustomUserClaims(uid, expectedClaims);
    const updatedUser = await adminAuth.getUser(uid);
    const actualClaims = updatedUser.customClaims || {};
    if (actualClaims.workspaceId !== expectedClaims.workspaceId || actualClaims.tenantId !== expectedClaims.tenantId || actualClaims.role !== expectedClaims.role) {
      return { success: false, reason: 'Firebase custom-claim read-back did not match the requested assignment' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, reason: err?.message || String(err) };
  }
}
