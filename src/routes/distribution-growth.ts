import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { appPool } from '../db/index.ts';
import { requireAuth, requireFounder, requireRole, type AuthenticatedRequest } from '../middleware/security.ts';
import { DISTRIBUTION_TENANT_ID } from '../lib/distribution-engine.ts';

const stages = ['new','qualified','contacted','replied','demo','pilot','customer','lost'] as const;
const stageSchema = z.object({ stage: z.enum(stages) }).strict();
const aeoStatus = ['backlog','published','monitoring','retired'] as const;
const aeoIntent = ['informational','commercial','comparison','navigational'] as const;
const aeoUpsertSchema = z.object({
  question: z.string().trim().min(8).max(500),
  intent: z.enum(aeoIntent).default('informational'),
  targetPath: z.string().trim().max(512).nullable().optional(),
  status: z.enum(aeoStatus).default('backlog'),
  answerEvidence: z.array(z.string().trim().min(1).max(512)).max(50).default([]),
}).strict();
const aeoObservationSchema = z.object({
  observedMentions: z.number().int().min(0).max(1000000),
  observedCitations: z.number().int().min(0).max(1000000),
  status: z.enum(aeoStatus).optional(),
}).strict();
const referralSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,80}$/),
  ownerType: z.enum(['founder','msp','consultant','vendor','partner']).default('founder'),
  ownerLabel: z.string().trim().min(1).max(160),
  destinationPath: z.string().trim().min(1).max(512),
}).strict();
const experimentSchema = z.object({
  name: z.string().trim().min(3).max(160),
  surface: z.string().trim().min(1).max(160),
  metric: z.string().trim().min(1).max(160),
  variants: z.array(z.object({ key:z.string().trim().min(1).max(40), label:z.string().trim().min(1).max(120) }).strict()).min(2).max(8),
  status: z.enum(['draft','running','paused','completed']).default('draft'),
}).strict();
const contentOpportunitySchema = z.object({
  kind: z.enum(['aeo','seo','faq','comparison','registry','case_study']),
  topic: z.string().trim().min(4).max(300),
  targetPath: z.string().trim().max(512).nullable().optional(),
  sourceEvidence: z.array(z.string().trim().min(1).max(512)).max(50).default([]),
  status: z.enum(['backlog','planned','published','monitoring','retired']).default('backlog'),
}).strict();
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
        const aeoResult = await client.query(`SELECT id,question,intent,target_path AS "targetPath",status,answer_evidence AS "answerEvidence",observed_mentions AS "observedMentions",observed_citations AS "observedCitations",last_checked_at AS "lastCheckedAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM distribution_aeo_queries WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 250`, [DISTRIBUTION_TENANT_ID]);
        const aeoRows = (aeoResult.rows ?? []).map((row: any) => {
          let evidence: unknown = [];
          try { evidence = JSON.parse(row.answerEvidence || '[]'); } catch { evidence = []; }
          return { ...row, answerEvidence: Array.isArray(evidence) ? evidence : [] };
        });
        const aeo = {
          queries: aeoRows,
          totals: {
            tracked: aeoRows.length,
            published: aeoRows.filter((row: any) => row.status === 'published' || row.status === 'monitoring').length,
            mentions: aeoRows.reduce((sum: number, row: any) => sum + Number(row.observedMentions || 0), 0),
            citations: aeoRows.reduce((sum: number, row: any) => sum + Number(row.observedCitations || 0), 0),
          },
        };
        const [funnelResult, referralResult, claimResult, experimentResult, contentResult, freeReviewResult] = await Promise.all([
          client.query(`SELECT event_name AS "eventName", COUNT(*)::int AS events, COUNT(DISTINCT session_id)::int AS sessions FROM traffic_events WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '30 days' GROUP BY event_name`),
          client.query(`SELECT COUNT(*)::int AS links, COALESCE(SUM(visits),0)::int AS visits, COALESCE(SUM(conversions),0)::int AS conversions FROM growth_referral_links WHERE tenant_id=$1 AND active=true`, [DISTRIBUTION_TENANT_ID]),
          client.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('lead_captured','claimed','customer'))::int AS engaged, COUNT(*) FILTER (WHERE status='customer')::int AS customers FROM growth_registry_claims WHERE tenant_id=$1`, [DISTRIBUTION_TENANT_ID]),
          client.query(`SELECT COUNT(*) FILTER (WHERE status='running')::int AS running, COUNT(*)::int AS total FROM growth_experiments WHERE tenant_id=$1`, [DISTRIBUTION_TENANT_ID]),
          client.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('published','monitoring'))::int AS published, COALESCE(SUM(observed_clicks),0)::int AS clicks, COALESCE(SUM(observed_conversions),0)::int AS conversions FROM growth_content_opportunities WHERE tenant_id=$1`, [DISTRIBUTION_TENANT_ID]),
          client.query(`SELECT COUNT(*)::int AS reviews, COUNT(*) FILTER (WHERE status='Completed')::int AS completed FROM free_review_submissions WHERE tenant_id=$1`, [DISTRIBUTION_TENANT_ID]),
        ]);
        const contacts = contactsResult.rows ?? [];
        const pipeline = Object.fromEntries(stages.map((stage) => [stage, contacts.filter((c: any) => c.pipelineStage === stage).length]));
        const funnelRows = funnelResult.rows ?? [];
        const funnel = Object.fromEntries(funnelRows.map((row:any) => [String(row.eventName), { events: Number(row.events || 0), sessions: Number(row.sessions || 0) }]));
        const growth = {
          funnel,
          referrals: referralResult.rows?.[0] ?? { links: 0, visits: 0, conversions: 0 },
          registryClaims: claimResult.rows?.[0] ?? { total: 0, engaged: 0, customers: 0 },
          experiments: experimentResult.rows?.[0] ?? { running: 0, total: 0 },
          content: contentResult.rows?.[0] ?? { total: 0, published: 0, clicks: 0, conversions: 0 },
          freeReviews: freeReviewResult.rows?.[0] ?? { reviews: 0, completed: 0 },
        };
        return { settings: settingsResult.rows?.[0] ?? null, pipeline, contacts, messages: messagesResult.rows?.[0] ?? { total: 0, sent: 0, failed: 0 }, aeo, growth };
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

  router.post('/founder/distribution/aeo', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = aeoUpsertSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid AEO query.' });
      const value = parsed.data;
      const id = `aeo-${crypto.randomUUID()}`;
      const result = await withTenant(async (client) => client.query(
        `INSERT INTO distribution_aeo_queries (id,tenant_id,question,intent,target_path,status,answer_evidence,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)
         ON CONFLICT (tenant_id, lower(question)) DO UPDATE SET
           intent=EXCLUDED.intent,
           target_path=EXCLUDED.target_path,
           status=EXCLUDED.status,
           answer_evidence=EXCLUDED.answer_evidence,
           updated_at=CURRENT_TIMESTAMP
         RETURNING id,question,intent,target_path AS "targetPath",status,answer_evidence AS "answerEvidence",
                   observed_mentions AS "observedMentions",observed_citations AS "observedCitations",
                   last_checked_at AS "lastCheckedAt",updated_at AS "updatedAt"`,
        [id, DISTRIBUTION_TENANT_ID, value.question, value.intent, value.targetPath ?? null, value.status, JSON.stringify(value.answerEvidence)]
      ));
      const row = result.rows?.[0];
      if (row) {
        try { row.answerEvidence = JSON.parse(row.answerEvidence || '[]'); } catch { row.answerEvidence = []; }
      }
      return res.status(201).json(row);
    } catch (error) { return next(error); }
  });

  router.patch('/founder/distribution/aeo/:queryId/observation', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = aeoObservationSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid AEO observation.' });
      const queryId = String(req.params.queryId || '').trim();
      if (!queryId || queryId.length > 128) return res.status(400).json({ error: 'Invalid AEO query id.' });
      const value = parsed.data;
      const result = await withTenant(async (client) => client.query(
        `UPDATE distribution_aeo_queries
         SET observed_mentions=$3,
             observed_citations=$4,
             status=COALESCE($5,status),
             last_checked_at=CURRENT_TIMESTAMP,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND tenant_id=$2
         RETURNING id,question,status,observed_mentions AS "observedMentions",
                   observed_citations AS "observedCitations",last_checked_at AS "lastCheckedAt"`,
        [queryId, DISTRIBUTION_TENANT_ID, value.observedMentions, value.observedCitations, value.status ?? null]
      ));
      if (!result.rows?.[0]) return res.status(404).json({ error: 'AEO query not found.' });
      return res.json(result.rows[0]);
    } catch (error) { return next(error); }
  });

  router.post('/founder/distribution/referrals', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed=referralSchema.safeParse(req.body);
      if(!parsed.success) return res.status(400).json({error:'Invalid referral link.'});
      const v=parsed.data;
      const result=await withTenant(async(client)=>client.query(
        `INSERT INTO growth_referral_links (id,tenant_id,code,owner_type,owner_label,destination_path)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id,code) DO UPDATE SET owner_type=EXCLUDED.owner_type,owner_label=EXCLUDED.owner_label,destination_path=EXCLUDED.destination_path,active=true,updated_at=CURRENT_TIMESTAMP
         RETURNING id,code,owner_type AS "ownerType",owner_label AS "ownerLabel",destination_path AS "destinationPath",active,visits,conversions`,
        [`ref-${crypto.randomUUID()}`,DISTRIBUTION_TENANT_ID,v.code,v.ownerType,v.ownerLabel,v.destinationPath]
      ));
      return res.status(201).json(result.rows?.[0]);
    } catch(error){ return next(error); }
  });

  router.post('/founder/distribution/experiments', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed=experimentSchema.safeParse(req.body);
      if(!parsed.success) return res.status(400).json({error:'Invalid growth experiment.'});
      const v=parsed.data;
      const result=await withTenant(async(client)=>client.query(
        `INSERT INTO growth_experiments (id,tenant_id,name,surface,status,variants,metric,started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5='running' THEN CURRENT_TIMESTAMP ELSE NULL END)
         RETURNING id,name,surface,status,variants,metric,started_at AS "startedAt",created_at AS "createdAt"`,
        [`exp-${crypto.randomUUID()}`,DISTRIBUTION_TENANT_ID,v.name,v.surface,v.status,JSON.stringify(v.variants),v.metric]
      ));
      return res.status(201).json(result.rows?.[0]);
    } catch(error){ return next(error); }
  });

  router.post('/founder/distribution/content-opportunities', ...founderOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed=contentOpportunitySchema.safeParse(req.body);
      if(!parsed.success) return res.status(400).json({error:'Invalid content opportunity.'});
      const v=parsed.data;
      const result=await withTenant(async(client)=>client.query(
        `INSERT INTO growth_content_opportunities (id,tenant_id,kind,topic,target_path,source_evidence,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id,kind,lower(topic)) DO UPDATE SET target_path=EXCLUDED.target_path,source_evidence=EXCLUDED.source_evidence,status=EXCLUDED.status,updated_at=CURRENT_TIMESTAMP
         RETURNING id,kind,topic,target_path AS "targetPath",status,observed_impressions AS "observedImpressions",observed_clicks AS "observedClicks",observed_conversions AS "observedConversions"`,
        [`content-${crypto.randomUUID()}`,DISTRIBUTION_TENANT_ID,v.kind,v.topic,v.targetPath ?? null,JSON.stringify(v.sourceEvidence),v.status]
      ));
      return res.status(201).json(result.rows?.[0]);
    } catch(error){ return next(error); }
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
