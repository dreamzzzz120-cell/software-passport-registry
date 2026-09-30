import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../middleware/security.ts';

const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({
  protocol: z.literal('m2m-trust/1'),
  envelopeDigest: hex64,
  actorMachineId: z.string().min(1).max(255),
  subjectMachineId: z.string().min(1).max(255),
  subjectPassportId: z.string().min(1).max(255),
  requestedAction: z.string().min(1).max(120),
  authorityDecision: z.enum(['AUTHORIZED','NOT_AUTHORIZED','UNKNOWN']),
  trustDecision: z.enum(['VERIFIED','PARTIAL','UNKNOWN','DENIED','REVOKED','EXPIRED']),
  executionOutcome: z.enum(['OBSERVED_SUCCEEDED','OBSERVED_FAILED','DENIED_NOT_EXECUTED','UNKNOWN']),
  evidenceDigest: hex64.nullable().optional(),
  observedAt: z.string().datetime({ offset: true }),
  receiptDigest: hex64
}).strict();

export async function verifyM2MPassport(req: AuthenticatedRequest, res: any, next: any) {
  try {
    const passportId = String(req.params.passportId ?? '');
    const passport = (await req.db!.execute(sql`
      SELECT id,name,verification_status AS "verificationStatus"
      FROM passports
      WHERE tenant_id=${req.user!.tenantId} AND id=${passportId}
      LIMIT 1
    `) as any).rows?.[0];
    if (!passport) return res.status(404).json({ passportId, passportState: 'UNKNOWN', passportVerified: false, reason: 'PASSPORT_NOT_FOUND' });

    const latestObservation = (await req.db!.execute(sql`
      SELECT canonical_payload_hash AS "canonicalPayloadHash", generated_at AS "generatedAt"
      FROM trust_observations
      WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passportId}
      ORDER BY observation_version DESC
      LIMIT 1
    `) as any).rows?.[0];

    const latestEvidence = (await req.db!.execute(sql`
      SELECT evidence_hash AS "evidenceHash", observed_at AS "observedAt"
      FROM evidence_ledger
      WHERE tenant_id=${req.user!.tenantId} AND passport_id=${passportId}
      ORDER BY observed_at DESC
      LIMIT 1
    `) as any).rows?.[0];

    const status = String(passport.verificationStatus ?? '').toLowerCase();
    const revoked = status.includes('revok');
    const expired = status.includes('expir');
    const evidenceDigest = latestObservation?.canonicalPayloadHash ?? latestEvidence?.evidenceHash ?? null;
    const hasEvidence = typeof evidenceDigest === 'string' && /^[a-f0-9]{64}$/.test(evidenceDigest);

    const passportState = revoked ? 'REVOKED' : expired ? 'EXPIRED' : hasEvidence ? 'ACTIVE' : (latestObservation || latestEvidence ? 'PARTIAL' : 'UNKNOWN');
    return res.json({
      protocol: 'm2m-trust/1',
      passportId,
      machineId: passportId,
      passportState,
      passportVerified: passportState === 'ACTIVE',
      evidenceDigest: hasEvidence ? evidenceDigest : null,
      observedAt: latestObservation?.generatedAt ?? latestEvidence?.observedAt ?? null,
      source: 'SPR',
      tenantScoped: true
    });
  } catch (error) { next(error); }
}

export async function recordM2MReceipt(req: AuthenticatedRequest, res: any, next: any) {
  const parsed = receiptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_M2M_RECEIPT', details: parsed.error.flatten() });
  try {
    const r = parsed.data;
    const passport = (await req.db!.execute(sql`
      SELECT id FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${r.subjectPassportId} LIMIT 1
    `) as any).rows?.[0];
    if (!passport) return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });

    const existing = (await req.db!.execute(sql`
      SELECT id,receipt_digest AS "receiptDigest"
      FROM m2m_trust_receipts
      WHERE tenant_id=${req.user!.tenantId} AND envelope_digest=${r.envelopeDigest}
      LIMIT 1
    `) as any).rows?.[0];
    if (existing) {
      if (existing.receiptDigest !== r.receiptDigest) return res.status(409).json({ error: 'M2M_RECEIPT_REPLAY_MISMATCH' });
      return res.status(200).json({ id: existing.id, created: false, receiptDigest: existing.receiptDigest });
    }

    const canonical = JSON.stringify(r, Object.keys(r).sort());
    const serverDigest = createHash('sha256').update(canonical).digest('hex');
    const id = 'm2mr_' + randomUUID();
    await req.db!.execute(sql`
      INSERT INTO m2m_trust_receipts(
        id,tenant_id,passport_id,envelope_digest,actor_machine_id,subject_machine_id,
        requested_action,authority_decision,trust_decision,execution_outcome,
        evidence_digest,observed_at,receipt_digest,server_record_digest
      ) VALUES (
        ${id},${req.user!.tenantId},${r.subjectPassportId},${r.envelopeDigest},${r.actorMachineId},${r.subjectMachineId},
        ${r.requestedAction},${r.authorityDecision},${r.trustDecision},${r.executionOutcome},
        ${r.evidenceDigest ?? null},${r.observedAt},${r.receiptDigest},${serverDigest}
      )
    `);
    return res.status(201).json({ id, created: true, receiptDigest: r.receiptDigest, serverRecordDigest: serverDigest });
  } catch (error) { next(error); }
}
