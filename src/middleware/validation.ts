/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

// Generic body-validation middleware. Runs a zod schema against req.body,
// replaces req.body with the parsed (typed, defaulted, stripped) result on
// success, and returns a structured 400 on failure — before any handler
// touches the database.
export const validateBody = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Request body failed validation',
        issues: result.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message
        }))
      });
    }
    req.body = result.data;
    next();
  };
};

// --- Shared fragments ---
const nonEmptyString = z.string().trim().min(1, 'must not be empty');
const emailSchema = z.string().trim().email('must be a valid email address');
const roleEnum = z.enum(['Owner', 'Admin', 'Technician', 'Viewer', 'Auditor', 'Client']);

// --- Auth / session ---
export const revokeSessionSchema = z.object({
  sessionId: nonEmptyString
});

export const recordLoginSchema = z.object({
  email: emailSchema,
  actionType: nonEmptyString,
  ip: z.string().trim().optional(),
  outcome: z.string().trim().optional(),
  details: z.string().trim().optional()
});

// --- User ---
export const userOnboardSchema = z.object({
  companyName: nonEmptyString,
  role: nonEmptyString,
  numTechnicians: z.number().int().nonnegative().optional(),
  clientCount: z.number().int().nonnegative().optional(),
  primaryUseCase: z.string().trim().optional()
});

export const userProfileSchema = z.object({
  roleTitle: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(200).optional()
});

// --- Organization ---
export const orgInviteSchema = z.object({
  email: emailSchema,
  role: roleEnum
});

export const teamRoleSchema = z.object({
  role: roleEnum
});

export const verifyMfaSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'must be a 6-digit code'),
  secret: z.string().trim().optional()
});

export const orgSecuritySchema = z.object({
  mfaEnabled: z.boolean()
});

// --- Clients ---
export const createClientSchema = z.object({
  name: nonEmptyString,
  domain: nonEmptyString,
  industry: z.string().trim().optional(),
  subscriptionTier: z.enum(['Standard', 'Enterprise', 'Premium']).optional()
});

export const clientTierSchema = z.object({
  subscriptionTier: z.enum(['Standard', 'Enterprise', 'Premium'])
});

// --- Compliance schedules ---
export const createComplianceScheduleSchema = z.object({
  clientId: nonEmptyString,
  frequency: nonEmptyString,
  targetEmail: emailSchema
});

export const updateComplianceScheduleSchema = z.object({
  frequency: z.string().trim().optional(),
  targetEmail: emailSchema.optional(),
  status: z.string().trim().optional()
});

// --- Scan schedules ---
export const createScanScheduleSchema = z.object({
  assetId: nonEmptyString,
  assetHostName: nonEmptyString,
  assetType: nonEmptyString,
  clientName: nonEmptyString,
  frequency: nonEmptyString,
  scanType: nonEmptyString
});

export const updateScanScheduleSchema = z.object({
  frequency: z.string().trim().optional(),
  scanType: z.string().trim().optional(),
  status: z.string().trim().optional()
});

// --- Evidence (controlled vocabulary — see EvidenceStatus in src/types.ts) ---
export const evidenceStatusEnum = z.enum([
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'DECLARED',
  'CONFIGURED',
  'OBSERVED',
  'FAILED',
  'UNKNOWN',
  'STALE',
  'SOURCE_DISCONNECTED',
  'NOT_APPLICABLE'
]);

const chainOfCustodyStepSchema = z.object({
  step: nonEmptyString,
  actor: nonEmptyString,
  timestamp: z.string().trim().min(1)
});

// A status of VERIFIED or PARTIALLY_VERIFIED is a claim that a real verification
// engine independently checked this evidence. That claim is only accepted if the
// full evidence record backing it is present. No exceptions — an item with a
// bare "status: VERIFIED" and nothing else is rejected before it ever reaches
// the database or a compliance score. Callers that don't have real verification
// infrastructure yet should submit DECLARED, OBSERVED, or CONFIGURED instead.
export const evidenceItemSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  type: z.enum(['Signature', 'Audit Report', 'Build Log', 'Security Scan', 'Attestation']),
  status: evidenceStatusEnum,
  signer: z.string().trim().optional().default('unknown'),
  timestamp: z.string().trim().min(1),
  hash: z.string().trim().optional().default(''),
  checksum: z.string().trim().optional(),
  chainOfCustody: z.array(chainOfCustodyStepSchema).optional(),
  verifierEngineId: z.string().trim().optional(),
  verifiedAt: z.string().trim().optional(),
  failureReason: z.string().trim().optional()
}).superRefine((item, ctx) => {
  if (item.status === 'VERIFIED' || item.status === 'PARTIALLY_VERIFIED') {
    if (!item.checksum) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checksum'], message: `checksum is required when status is ${item.status}` });
    }
    if (!item.chainOfCustody || item.chainOfCustody.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chainOfCustody'], message: `at least one chain-of-custody step is required when status is ${item.status}` });
    }
    if (!item.verifierEngineId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['verifierEngineId'], message: `verifierEngineId is required when status is ${item.status}` });
    }
    if (!item.verifiedAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['verifiedAt'], message: `verifiedAt is required when status is ${item.status}` });
    }
  }
  if (item.status === 'FAILED' && !item.failureReason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['failureReason'], message: 'failureReason is required when status is FAILED' });
  }
});

// --- Passports ---
export const createPassportSchema = z.object({
  clientId: nonEmptyString.optional(),
  name: nonEmptyString,
  version: nonEmptyString,
  publisher: nonEmptyString,
  category: z.string().trim().optional(),
  licenseType: z.string().trim().optional()
});

// PUT /api/passports/:id merges an arbitrary subset of passport fields onto an
// existing row. Most fields stay permissive (unknown/extra keys pass through —
// the handler only reads fields it knows about), but `evidence` is the one field
// that feeds directly into compliance scoring and passport display, so it is
// validated strictly via evidenceItemSchema rather than passed through as-is.
export const updatePassportSchema = z.object({
  name: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1).optional(),
  publisher: z.string().trim().min(1).optional(),
  category: z.string().trim().optional(),
  licenseType: z.string().trim().optional(),
  fileHash: z.string().trim().optional(),
  evidence: z.array(evidenceItemSchema).optional()
}).passthrough();

// --- Scans ---
export const createScanSchema = z.object({
  targetName: nonEmptyString,
  scanType: z.string().trim().optional(),
  clientName: z.string().trim().optional()
});

export const batchTagScansSchema = z.object({
  scanIds: z.array(nonEmptyString).min(1, 'at least one scanId is required'),
  customCategory: nonEmptyString
});

// --- Alerts ---
export const updateAlertSchema = z.object({
  status: nonEmptyString
});

export const createAlertSchema = z.object({
  title: nonEmptyString,
  severity: nonEmptyString,
  category: nonEmptyString,
  clientName: nonEmptyString,
  description: nonEmptyString
});

// --- Integrations ---
export const updateIntegrationSchema = z.object({
  connected: z.boolean().optional(),
  apiKeyHint: z.string().trim().optional(),
  lastSyncDate: z.string().trim().optional()
});

// --- Billing ---
export const billingCheckoutSchema = z.object({
  billingId: nonEmptyString
});

// --- Agent jobs ---
export const createAgentJobSchema = z.object({
  agentId: nonEmptyString,
  passportId: nonEmptyString,
  jobType: z.string().trim().optional()
});

export const createRepositoryConnectionSchema = z.object({
  provider: z.literal('github'),
  installationId: nonEmptyString,
  label: nonEmptyString
}).strict();

const repositorySegment = z.string().trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/);

export const createRepositoryScanSchema = z.object({
  provider: z.literal('github'),
  owner: repositorySegment,
  repository: repositorySegment,
  ref: z.string().trim().min(1).max(255).optional(),
  subdirectory: z.string().trim().max(500).optional().default(''),
  connectionId: nonEmptyString
}).strict().superRefine((value, ctx) => {
  const subdirectory = value.subdirectory.replaceAll('\\', '/');
  if (
    subdirectory.startsWith('/') ||
    subdirectory.split('/').some(segment => segment === '..' || segment === '.')
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['subdirectory'],
      message: 'REPOSITORY_PATH_INVALID'
    });
  }
});

export const createTrustObservationSchema = z.object({
  generationReason: z.enum([
    'manual', 'scheduled_refresh', 'evidence_change',
    'finding_change', 'collector_recovery', 'system'
  ]).optional().default('manual')
}).strict();

// --- AI endpoints ---
export const analyzePassportSchema = z.object({
  passportId: nonEmptyString
});

export const aiAdvisorSchema = z.object({
  message: nonEmptyString,
  passportName: z.string().trim().optional(),
  vulnerabilities: z.any().optional()
});
