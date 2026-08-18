/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp, cert, applicationDefault, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from '../config.ts';

function parseServiceAccount(raw: string): ServiceAccount {
  let candidate = raw.trim().replace(/^\uFEFF/, '');

  // Accept a raw JSON object, a JSON-encoded string containing that object,
  // or an env value with harmless wrapper text around the JSON object.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === 'string') {
        candidate = parsed.trim().replace(/^\uFEFF/, '');
        continue;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Service account value is not a JSON object');
      }

      const value = parsed as Record<string, unknown>;
      const projectId = value.projectId ?? value.project_id;
      const clientEmail = value.clientEmail ?? value.client_email;
      const privateKey = value.privateKey ?? value.private_key;

      const normalized: ServiceAccount = {
        projectId: typeof projectId === 'string' ? projectId.trim() : '',
        clientEmail: typeof clientEmail === 'string' ? clientEmail.trim() : '',
        privateKey: typeof privateKey === 'string' ? privateKey.replace(/\\n/g, '\n') : '',
      };

      return normalized;
    } catch (error) {
      // If the value contains wrapper text, isolate the outermost JSON object.
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start && (start !== 0 || end !== candidate.length - 1)) {
        candidate = candidate.slice(start, end + 1).trim();
        continue;
      }
      if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error;
      throw new Error('Service account value is not valid JSON');
    }
  }

  throw new Error('Service account value could not be normalized');
}

function parseBase64ServiceAccount(raw: string): ServiceAccount {
  const decoded = Buffer.from(raw.trim(), 'base64').toString('utf8');
  return parseServiceAccount(decoded);
}

function validateServiceAccount(payload: ServiceAccount) {
  if (!payload.projectId || !payload.clientEmail || !payload.privateKey) {
    throw new Error('Service account is missing required fields');
  }
  if (config.firebase.projectId && payload.projectId !== config.firebase.projectId) {
    throw new Error('Service account project does not match FIREBASE_PROJECT_ID');
  }
}

function loadAdminCredential() {
  if (config.firebase.serviceAccountKeyB64) {
    try {
      const payload = parseBase64ServiceAccount(config.firebase.serviceAccountKeyB64);
      validateServiceAccount(payload);
      console.info('[Firebase Admin] Using FIREBASE_SERVICE_ACCOUNT_KEY_B64');
      return cert(payload);
    } catch (error) {
      console.error('[Firebase Admin] Invalid FIREBASE_SERVICE_ACCOUNT_KEY_B64:', error instanceof Error ? error.message : 'invalid credential');
      return undefined;
    }
  }

  if (config.firebase.serviceAccountKey) {
    try {
      const payload = parseServiceAccount(config.firebase.serviceAccountKey);
      validateServiceAccount(payload);
      console.info('[Firebase Admin] Using FIREBASE_SERVICE_ACCOUNT_KEY');
      return cert(payload);
    } catch (error) {
      console.error('[Firebase Admin] Invalid FIREBASE_SERVICE_ACCOUNT_KEY:', error instanceof Error ? error.message : 'invalid credential');
      return undefined;
    }
  }

  if (config.firebase.googleApplicationCredentials) return applicationDefault();

  if (config.isProduction) {
    console.error('[Firebase Admin] Firebase Admin credentials are not configured; auth requests will fail until credentials are supplied.');
  }
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
