import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ScopedDb } from '../../middleware/tenant-scope.ts';

export type AgentReceiptActor = {
  tenantId: string;
  uid: string;
  email: string;
  role: string;
};

export type AgentReceiptAction = {
  id: string;
  type: string;
  endpoint: string;
  method: 'POST' | 'PATCH';
  description: string;
  payload: Record<string, unknown>;
  evidence?: Record<string, unknown>;
};

export async function recordAgentConfirmationReceipt(
  db: ScopedDb,
  actor: AgentReceiptActor,
  input: { inputText?: string; action: AgentReceiptAction },
) {
  const receiptId = `agentrcpt_${randomUUID().replaceAll('-', '')}`;
  const action = input.action;
  await db.execute(sql`
    INSERT INTO agent_interaction_receipts
      (id, tenant_id, actor_uid, actor_email, actor_role, interaction_kind, intent, input_text,
       proposed_action_id, proposed_action_type, proposed_endpoint, proposed_method,
       observed_context, recommendation, confirmation, execution_result)
    VALUES
      (${receiptId}, ${actor.tenantId}, ${actor.uid}, ${actor.email}, ${actor.role},
       'proposal', ${action.type}, ${input.inputText ?? null},
       ${action.id}, ${action.type}, ${action.endpoint}, ${action.method},
       ${JSON.stringify(action.evidence ?? {})}::jsonb,
       ${JSON.stringify({ description: action.description, payload: action.payload })}::jsonb,
       ${JSON.stringify({ confirmed: true, confirmedAt: new Date().toISOString() })}::jsonb,
       '{}'::jsonb)
  `);
  return { receiptId, status: 'CONFIRMED' as const, actionId: action.id };
}

export async function recordAgentOutcomeReceipt(
  db: ScopedDb,
  actor: AgentReceiptActor,
  input: {
    parentReceiptId: string;
    action: AgentReceiptAction;
    ok: boolean;
    httpStatus: number;
    result: Record<string, unknown>;
    error?: string;
  },
) {
  const parent = (await db.execute(sql`
    SELECT id FROM agent_interaction_receipts
    WHERE id=${input.parentReceiptId}
      AND tenant_id=${actor.tenantId}
      AND actor_uid=${actor.uid}
    LIMIT 1
  `) as any).rows?.[0];
  if (!parent) return null;

  const receiptId = `agentrcpt_${randomUUID().replaceAll('-', '')}`;
  const kind = input.ok ? 'execution' : 'failure';
  const action = input.action;

  await db.execute(sql`
    INSERT INTO agent_interaction_receipts
      (id, tenant_id, actor_uid, actor_email, actor_role, interaction_kind, intent,
       proposed_action_id, proposed_action_type, proposed_endpoint, proposed_method,
       observed_context, recommendation, confirmation, execution_result, parent_receipt_id)
    VALUES
      (${receiptId}, ${actor.tenantId}, ${actor.uid}, ${actor.email}, ${actor.role},
       ${kind}, ${action.type},
       ${action.id}, ${action.type}, ${action.endpoint}, ${action.method},
       ${JSON.stringify(action.evidence ?? {})}::jsonb,
       ${JSON.stringify({ description: action.description })}::jsonb,
       ${JSON.stringify({ confirmed: true, parentReceiptId: input.parentReceiptId })}::jsonb,
       ${JSON.stringify({ source: 'authorized_route_response', ok: input.ok, httpStatus: input.httpStatus, result: input.result, error: input.error ?? null })}::jsonb,
       ${input.parentReceiptId})
  `);

  return {
    receiptId,
    parentReceiptId: input.parentReceiptId,
    status: input.ok ? 'EXECUTED' as const : 'FAILED' as const,
  };
}
