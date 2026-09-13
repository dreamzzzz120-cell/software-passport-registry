import { Router } from 'express';
import { z } from 'zod';
import { appPool } from '../db/index.ts';
import { requireAuth, requireFounder, requireRole, type AuthenticatedRequest } from '../middleware/security.ts';
import { DISTRIBUTION_TENANT_ID } from '../lib/distribution-engine.ts';

const stages = ['new','qualified','contacted','replied','demo','pilot','customer','lost'] as const;
const stageSchema = z.object({ stage: z.enum(stages) }).strict();
const settingsSchema = z.object({
  discoveryEnabled: z.boolean().optional(),
  outreachEnabled: z.boolean().optional(),
  dailySendCap: z.number().int().min(1).max(500).optional(),
  followupDelayDays: z.number().int().min(1).max(30).optional(),
  maxFollowups: z.number().int().min(0).max(3).optional(),
  demoUrl: z.string().trim().url().max(2048).nullable().optional(),
}).strict();

const founderOnly = [requireAuth, requireRole('Owner'), requireFounder];

async function withTenant<T>(fn: (client: any) => Promise<T>) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [DISTRIBUTION_TENANT_ID]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export function createDistributionGrowthRouter() {
  const router = Router();

  router.get('/founder/distribution/growth', ...founderOnly, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const payload = await withTenant(async (client) => {
        const settingsResult = await client.query(`SELECT discovery_enabled AS "discoveryEnabled", outreach_enabled AS "outreachEnabled", daily_send_cap AS "dailySendCap", followup_delay_days AS "followupDelayDays", max_followups AS "maxFollowups", demo_url AS "demoUrl", updated_at AS "updatedAt" FROM distribution_campaign_settings WHERE tenant_id=$1 LIMIT 1`, [DISTRIBUTION_TENANT_ID]);
        const contactsResult = await client.query(`SELECT id,email,company,source_url AS "sourceUrl",evidence,outreach_basis AS "outreachBasis",status,pipeline_stage AS "pipelineStage",last_contacted_at AS "lastContactedAt",next_followup_at AS "nextFollowupAt",followup_count AS "followupCount",replied_at AS "repliedAt",demo_at AS "demoAt",pilot_at AS "pilotAt",customer_at AS "customerAt",lost_at AS "lostAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM distribution_contacts WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 500`, [DISTRIBUTION_TENANT_ID]);
        const messagesResult = await client.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='sent')::int AS sent, COUNT(*) FILTER (WHERE status='failed')::int AS failed FROM distribution_messages WHERE tenant_id=$1`, [DISTRIBUTION_TENANT_ID]);
        const contacts = contactsResult.rows ?? [];
        const pipeline = Object.fromEntries(stages.map((stage) => [stage, contacts.filter((c: any) => c.pipelineStage === stage).length]));
        return { settings: settingsResult.rows?.[0] ?? null, pipeline, contacts, messages: messagesResult.rows?.[0] ?? { total: 0, sent: 0, failed: 0 } };
      });
      return res.json({ ...payload, generatedAt: new Date().toISOString(), evidencePolicy: 'Pipeline stage is operational state, not trust evidence. Qualification and conversion claims remain observational until recorded.' });
    } catch (error) { return next(error); }
  });

  router.patch('/founder/distribution/contacts/:contactId/stage', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = stageSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'A valid pipeline stage is required.' });
      const contactId = String(req.params.contactId || '').trim();
      if (contactId.length < 1 || contactId.length > 128) return res.status(400).json({ error: 'Invalid contact id.' });
      const result = await withTenant(async (client) => client.query(`UPDATE distribution_contacts SET pipeline_stage=$3, replied_at=CASE WHEN $3='replied' THEN COALESCE(replied_at,CURRENT_TIMESTAMP) ELSE replied_at END, demo_at=CASE WHEN $3='demo' THEN COALESCE(demo_at,CURRENT_TIMESTAMP) ELSE demo_at END, pilot_at=CASE WHEN $3='pilot' THEN COALESCE(pilot_at,CURRENT_TIMESTAMP) ELSE pilot_at END, customer_at=CASE WHEN $3='customer' THEN COALESCE(customer_at,CURRENT_TIMESTAMP) ELSE customer_at END, lost_at=CASE WHEN $3='lost' THEN COALESCE(lost_at,CURRENT_TIMESTAMP) ELSE lost_at END, updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2 RETURNING id,pipeline_stage AS "pipelineStage",updated_at AS "updatedAt"`, [contactId, DISTRIBUTION_TENANT_ID, parsed.data.stage]));
      if (!result.rows?.[0]) return res.status(404).json({ error: 'Contact not found.' });
      return res.json(result.rows[0]);
    } catch (error) { return next(error); }
  });

  router.patch('/founder/distribution/campaign', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid campaign settings.' });
      const value = parsed.data;
      const result = await withTenant(async (client) => client.query(`INSERT INTO distribution_campaign_settings (tenant_id,discovery_enabled,outreach_enabled,daily_send_cap,followup_delay_days,max_followups,demo_url,updated_at) VALUES ($1,COALESCE($2,false),COALESCE($3,false),COALESCE($4,50),COALESCE($5,5),COALESCE($6,2),$7,CURRENT_TIMESTAMP) ON CONFLICT (tenant_id) DO UPDATE SET discovery_enabled=COALESCE($2,distribution_campaign_settings.discovery_enabled), outreach_enabled=COALESCE($3,distribution_campaign_settings.outreach_enabled), daily_send_cap=COALESCE($4,distribution_campaign_settings.daily_send_cap), followup_delay_days=COALESCE($5,distribution_campaign_settings.followup_delay_days), max_followups=COALESCE($6,distribution_campaign_settings.max_followups), demo_url=CASE WHEN $7 IS NULL THEN distribution_campaign_settings.demo_url ELSE $7 END, updated_at=CURRENT_TIMESTAMP RETURNING discovery_enabled AS "discoveryEnabled", outreach_enabled AS "outreachEnabled", daily_send_cap AS "dailySendCap", followup_delay_days AS "followupDelayDays", max_followups AS "maxFollowups", demo_url AS "demoUrl", updated_at AS "updatedAt"`, [DISTRIBUTION_TENANT_ID,value.discoveryEnabled,value.outreachEnabled,value.dailySendCap,value.followupDelayDays,value.maxFollowups,value.demoUrl ?? null]));
      return res.json(result.rows?.[0]);
    } catch (error) { return next(error); }
  });

  return router;
}
