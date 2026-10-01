import type { PoolClient } from 'pg';
import type { M2MReplayStore } from './m2m-envelope.ts';

export class PostgresM2MReplayStore implements M2MReplayStore {
  constructor(private readonly client: PoolClient) {}

  async consumeNonce(input: { issuer: string; tenantId: string; nonce: string; envelopeId: string; expiresAt: string }): Promise<boolean> {
    const tenant = await this.client.query<{ tenant_id: string | null }>(
      "SELECT current_setting('app.tenant_id', true) AS tenant_id"
    );
    const scopedTenant = tenant.rows[0]?.tenant_id ?? null;
    if (scopedTenant !== input.tenantId) throw new Error('M2M_RLS_TENANT_CONTEXT_MISMATCH');

    const inserted = await this.client.query(
      `INSERT INTO spr_m2m_nonce_receipts
        (tenant_id, issuer, nonce, envelope_id, expires_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, issuer, nonce) DO NOTHING
       RETURNING nonce`,
      [input.tenantId, input.issuer, input.nonce, input.envelopeId, input.expiresAt]
    );
    return inserted.rowCount === 1;
  }
}
