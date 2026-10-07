import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ScopedDb } from '../../middleware/tenant-scope.ts';
import type { AgentReceiptAction, AgentReceiptActor } from './agent-receipts.ts';

function receiptEvidenceHash(value: unknown): string {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function recordRuntimeExecutionEvidence(
  db: ScopedDb,
  actor: AgentReceiptActor,
  input: {
    receiptId: string;
    parentReceiptId: string;
    action: AgentReceiptAction;
    ok: boolean;
    httpStatus: number;
    result: Record<string, unknown>;
    error?: string;
  },
) {
  const evidenceRef = receiptEvidenceHash({
    receiptId: input.receiptId,
    parentReceiptId: input.parentReceiptId,
    actionId: input.action.id,
    actionType: input.action.type,
    endpoint: input.action.endpoint,
    method: input.action.method,
    ok: input.ok,
    httpStatus: input.httpStatus,
  });
  const eventId = 'asevt_' + randomUUID().replaceAll('-', '');
  const outcome = input.ok ? 'SUCCEEDED' : 'FAILED';
  await db.execute(sql`
    INSERT INTO agent_security_events
      (id, tenant_id, agent_asset_id, event_type, source_origin, source_ref,
       action_capability, target_ref, outcome, severity, evidence_ids, detail, observed_at)
    VALUES
      (${eventId}, ${actor.tenantId}, NULL, 'execution_receipt', 'INTERNAL', ${input.parentReceiptId},
       ${input.action.type}, ${input.action.endpoint}, ${outcome}, 'informational',
       ${JSON.stringify([input.receiptId, input.parentReceiptId, evidenceRef])}::jsonb,
       ${JSON.stringify({
         receiptId: input.receiptId,
         parentReceiptId: input.parentReceiptId,
         actionId: input.action.id,
         method: input.action.method,
         endpoint: input.action.endpoint,
         httpStatus: input.httpStatus,
         resultKeys: Object.keys(input.result || {}).slice(0, 50),
         errorPresent: Boolean(input.error),
       })}::jsonb,
       NOW())
  `);
  return { eventId, evidenceRef, outcome };
}
