import { hasVerifiedNorthAmericanCountry } from './distribution-geo.ts';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, appPool } from '../db/index.ts';
import { createWorkerPool } from '../workers/worker-db.ts';
import { renderBrandedEmail, SPR_DEFAULT_BRAND, sendBrandedEmail } from './branded-email.ts';
import { DISTRIBUTION_TENANT_ID } from './distribution-engine.ts';
import { DistributionDeferredError, withReservedOutreach } from './distribution-send-reservation.ts';

// Distribution runs in both the API and the dedicated worker. Worker-originated
// outreach must use WORKER_DATABASE_URL, not the HTTP app pool's credential.
// Otherwise the reservation transaction can fail on distribution_send_attempts
// even while ordinary discovery jobs succeed through createWorkerPool().
const outreachDbPool = process.env.PROCESS_ROLE?.trim() === 'worker' ? createWorkerPool() : appPool;

const PUBLIC_ORIGIN = 'https://www.softwarepassportregistry.com';
const DAILY_LIMIT = Math.max(1, Math.min(1000, Number.parseInt(process.env.DISTRIBUTION_DAILY_SEND_LIMIT ?? '50', 10) || 50));
const SEND_INTERVAL_MS = Math.max(1000, Number.parseInt(process.env.DISTRIBUTION_SEND_INTERVAL_MS ?? '1000', 10) || 1000);

// Outreach mail leaves from its own address (DISTRIBUTION_OUTREACH_FROM,
// e.g. "Software Passport Registry <ceo@softwarepassportregistry.com>")
// so that transactional mail (verification, reset, invites) keeps EMAIL_FROM
// and replies to outreach reach the person who sent it. Falls back to
// EMAIL_FROM when unset.
export function outreachSender(): { from: string | undefined; replyTo: string | undefined } {
  const from = process.env.DISTRIBUTION_OUTREACH_FROM?.trim() || undefined;
  const replyTo = from ? (from.match(/<([^>]+)>/)?.[1] ?? from) : undefined;
  return { from, replyTo };
}

export function autonomousOutreachEnabled() {
  return process.env.DISTRIBUTION_AUTONOMOUS_OUTREACH === 'true' && Boolean(process.env.RESEND_API_KEY?.trim()) && Boolean(process.env.EMAIL_FROM?.trim());
}

function outreachAllowed(basis: unknown) {
  if (!autonomousOutreachEnabled()) throw new Error('DISTRIBUTION_AUTONOMOUS_OUTREACH_DISABLED');
  if (basis !== 'consent' && basis !== 'legitimate_interest') throw new Error('DISTRIBUTION_OUTREACH_BASIS_REQUIRED');
  if (basis === 'legitimate_interest' && process.env.DISTRIBUTION_LI_ATTESTED !== 'true') throw new Error('DISTRIBUTION_LI_ATTESTATION_REQUIRED');
}

export function outreachToken(email: string) {
  // SPR_PUBLIC_PASSPORT_SECRET is the variable the platform actually sets
  // (src/config.ts); the unprefixed name is accepted for compatibility.
  const secret = process.env.SPR_PUBLIC_PASSPORT_SECRET?.trim() || process.env.PUBLIC_PASSPORT_SECRET?.trim();
  if (!secret) throw new Error('SPR_PUBLIC_PASSPORT_SECRET_REQUIRED');
  return crypto.createHmac('sha256', secret).update(`distribution-unsubscribe-v1:${email.trim().toLowerCase()}`).digest('hex').slice(0, 48);
}

export function unsubscribeUrl(email: string) {
  return `${PUBLIC_ORIGIN}/api/public/distribution/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(outreachToken(email))}`;
}

function validEmailAddress(email: string) {
  const [local, domain] = email.trim().toLowerCase().split('@');
  return Boolean(local && domain && domain.includes('.') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
}

function validRoleAddress(email: string) {
  const [local, domain] = email.trim().toLowerCase().split('@');
  if (!local || !domain || !domain.includes('.')) return false;
  if (['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','me.com','aol.com'].includes(domain)) return false;
  return /^(info|sales|hello|contact|security|support|office|admin|marketing|business|partners|partnerships|service|services)$/.test(local);
}

export function extractPublicRoleEmails(html: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/(?:mailto:)?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
    const email = String(match[1]).toLowerCase();
    if (validRoleAddress(email)) found.add(email);
  }
  return [...found].slice(0, 5);
}

export type QLegionOutreachStrategy = 'proof_first' | 'revenue_first' | 'compliance_first' | 'baseline';

type QLegionAttribution = {
  missionId: string | null;
  strategyId: QLegionOutreachStrategy;
  probability: number | null;
};

function strategyLabel(strategyId: QLegionOutreachStrategy) {
  if (strategyId === 'proof_first') return 'Proof-first';
  if (strategyId === 'revenue_first') return 'Recurring revenue';
  if (strategyId === 'compliance_first') return 'Compliance evidence';
  return 'Baseline';
}

async function resolveQLegionAttribution(client: any, sourceUrl: string | null): Promise<QLegionAttribution> {
  if (!sourceUrl) return { missionId: null, strategyId: 'baseline', probability: null };
  // Q-Legion advice is optional. In environments that have not provisioned its
  // tables, use the existing baseline copy instead of aborting a fully gated
  // outreach send. Do not swallow SQL permission or other runtime failures.
  const optionalTables = await client.query("SELECT to_regclass('public.q_legion_settings') AS settings, to_regclass('public.q_legion_missions') AS missions");
  if (!optionalTables.rows?.[0]?.settings || !optionalTables.rows?.[0]?.missions) {
    console.warn('[Distribution] optional Q-Legion advisory tables absent; using baseline outreach copy');
    return { missionId: null, strategyId: 'baseline', probability: null };
  }
  const enabled = await client.query(
    `SELECT strategy_execution_enabled AS enabled FROM q_legion_settings WHERE tenant_id=$1 LIMIT 1`,
    [DISTRIBUTION_TENANT_ID],
  );
  if (enabled.rows?.[0]?.enabled !== true) return { missionId: null, strategyId: 'baseline', probability: null };

  const result = await client.query(
    `SELECT q.id, q.advisory_strategy_id, q.strategies
     FROM q_legion_missions q
     JOIN distribution_jobs j ON j.id=q.source_id AND j.tenant_id=q.tenant_id
     WHERE q.tenant_id=$1
       AND q.source_kind='distribution_research'
       AND q.advisory_strategy_id IS NOT NULL
       AND COALESCE(j.result->>'url', j.payload->>'url')=$2
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(q.red_team_findings) finding
         WHERE finding->>'severity'='BLOCKER'
       )
     ORDER BY q.updated_at DESC
     LIMIT 1`,
    [DISTRIBUTION_TENANT_ID, sourceUrl],
  );
  const row = result.rows?.[0];
  if (!row) return { missionId: null, strategyId: 'baseline', probability: null };
  const strategyId = ['proof_first','revenue_first','compliance_first'].includes(String(row.advisory_strategy_id))
    ? String(row.advisory_strategy_id) as QLegionOutreachStrategy
    : 'baseline';
  const strategies = Array.isArray(row.strategies) ? row.strategies : [];
  const strategy = strategies.find((item: any) => item && item.id === strategyId);
  const probability = typeof strategy?.probability === 'number' && Number.isFinite(strategy.probability)
    ? Math.max(0, Math.min(1, strategy.probability))
    : null;
  return { missionId: String(row.id), strategyId, probability };
}

export function makeCopy(
  company: string,
  evidence: Record<string, unknown>,
  followup: boolean,
  strategyId: QLegionOutreachStrategy = 'baseline',
) {
  const signals = evidence.signals && typeof evidence.signals === 'object' ? evidence.signals as Record<string, unknown> : {};
  const name = company.trim();
  const greeting = name ? `Hi ${name} team,` : 'Hi there,';
  const theirClients = name ? `${name}'s clients` : 'your clients';
  const cta = { label: 'See how SPR works', url: `${PUBLIC_ORIGIN}/` };

  if (strategyId === 'revenue_first') {
    if (followup) return {
      subject: `A recurring software-assurance service for ${name || 'your MSP'}`,
      intro: [greeting, 'Following up on SPR. The use case is not another scanner for your technicians; it is a repeatable client service you can deliver under your own brand: software inventory evidence, SBOM, vulnerability visibility, change monitoring, and a client-ready report.', 'I can run one free example so you can judge whether it is something your clients would pay you to deliver. Reply if you want me to set it up.'],
      cta,
    };
    return {
      subject: `Add a recurring software-assurance service for ${theirClients}`,
      intro: [greeting, `I'm Keith, founder of Software Passport Registry. SPR is designed to let MSPs turn software trust and vendor-review work into a repeatable managed service instead of one-off manual effort.`, 'It produces evidence-backed software inventory, SBOM and vulnerability visibility, ongoing change monitoring, and white-label client reporting. Unknowns stay UNKNOWN rather than being presented as verified.', 'I can run one free example for a client stack you choose so you can judge the deliverable before spending anything.'],
      cta,
    };
  }

  if (strategyId === 'compliance_first') {
    const observedFit = signals.compliance
      ? 'Your public site mentions compliance work, which is why this evidence-first angle may be relevant.'
      : signals.cybersecurity
        ? 'Your public site mentions security services, which is why this evidence-first angle may be relevant.'
        : 'SPR is designed for software-assurance and vendor-review workflows where evidence quality matters.';
    if (followup) return {
      subject: `SBOM and vendor-risk evidence for ${name || 'your MSP'}`,
      intro: [greeting, 'Following up on SPR. It preserves the evidence behind software inventory, SBOM, vulnerabilities, provenance, and changes so a client or reviewer can see what was actually observed and what remains unknown.', 'I can run a free example and show you the evidence chain in 15 minutes. Reply if you want one.'],
      cta,
    };
    return {
      subject: `Client-ready SBOM and vendor-risk evidence for ${theirClients}`,
      intro: [greeting, `I'm Keith, founder of Software Passport Registry. SPR gives MSPs an evidence-first way to produce software inventory, SBOM, vulnerability and vendor-risk reporting without turning missing evidence into a compliance claim.`, observedFit, 'The output can be white-labelled for the client, with provenance and UNKNOWN states preserved. I can run one free example so you can inspect the evidence yourself.'],
      cta,
    };
  }

  const fit = signals.compliance
    ? 'Your site mentions compliance work, so this gives you the software evidence auditors and vendor-risk reviews ask for.'
    : signals.cybersecurity
      ? 'Your site mentions security services, so this adds software supply-chain evidence to what you already sell.'
      : 'It gives you a concrete, repeatable software-risk deliverable for every client.';

  if (followup) return {
    subject: `Free client software report for ${name || 'your MSP'}`,
    intro: [greeting, `Following up on my earlier note. The offer stands: I'll run one free software risk report on a client stack you choose, white-labelled with your logo, and walk you through it in 15 minutes.`, 'Reply to this email to set it up. If it isn\'t a fit, the opt-out link below stops any further messages.'],
    cta,
  };
  return {
    subject: `White-label software risk reports for ${theirClients}`,
    intro: [greeting, `I'm Keith, founder of Software Passport Registry, a software-risk company in Kelowna, BC. SPR scans a client's code and applications, builds the software bill of materials, checks every component against known vulnerabilities, and produces a report under your logo that you can hand to the client.`, fit, `I'll run one free report on a client stack of your choice and walk you through it in 15 minutes, by call or in person. Reply to this email to set it up.`],
    cta,
  };
}


async function withTenant<T>(fn: (client: any) => Promise<T>) {
  const client = await outreachDbPool.connect();
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

async function sendGate(client: any, contact: any) {
  outreachAllowed(contact.outreach_basis);
  // Fail closed for initial and follow-up sends: unverified geography is held.
  if (!hasVerifiedNorthAmericanCountry(contact.evidence)) {
    throw new DistributionDeferredError('DISTRIBUTION_COUNTRY_VERIFICATION_REQUIRED', 86_400_000);
  }
  if (contact.outreach_basis === 'consent' && !contact.consent_evidence_url?.trim()) throw new Error('DISTRIBUTION_CONSENT_EVIDENCE_REQUIRED');
  const { from } = outreachSender();
  const to = process.env.DISTRIBUTION_OUTREACH_VERIFY_TO?.trim().toLowerCase();
  if (!from || !to) throw new DistributionDeferredError('DISTRIBUTION_SENDER_VERIFICATION_REQUIRED');
  const verified = await client.query(`SELECT 1 FROM distribution_sender_verifications
    WHERE lower(from_address)=lower($1) AND lower(to_address)=$2 AND status='sent'
    AND NULLIF(btrim(provider_message_id),'') IS NOT NULL LIMIT 1`, [from,to]);
  if (!verified.rows?.length) throw new DistributionDeferredError('DISTRIBUTION_SENDER_VERIFICATION_REQUIRED');
}

export async function queueContact(email: string, company: string | null, sourceUrl: string | null, evidence: Record<string, unknown>, outreachBasis: string, consentEvidenceUrl: string | null) {
  if (outreachBasis === 'consent') {
    if (!validEmailAddress(email)) throw new Error('DISTRIBUTION_EMAIL_INVALID');
    if (!consentEvidenceUrl?.trim()) throw new Error('DISTRIBUTION_CONSENT_EVIDENCE_REQUIRED');
  } else if (!validRoleAddress(email)) {
    throw new Error('DISTRIBUTION_ROLE_EMAIL_REQUIRED');
  }
  if (!['consent','legitimate_interest'].includes(outreachBasis)) throw new Error('DISTRIBUTION_OUTREACH_BASIS_INVALID');
  const id = `dc_${crypto.randomUUID().replace(/-/g, '')}`;
  return withTenant(async (client) => {
    const existing = await client.query(`SELECT id FROM distribution_contacts WHERE tenant_id=$1 AND lower(email)=lower($2) LIMIT 1`, [DISTRIBUTION_TENANT_ID, email.trim()]);
    if (existing.rows?.[0]?.id) return String(existing.rows[0].id);
    const inserted = await client.query(`INSERT INTO distribution_contacts (id,tenant_id,email,company,source_url,evidence,outreach_basis,consent_evidence_url) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT (tenant_id,email) DO NOTHING RETURNING id`, [id,DISTRIBUTION_TENANT_ID,email.trim().toLowerCase(),company,sourceUrl,JSON.stringify(evidence),outreachBasis,consentEvidenceUrl]);
    if (inserted.rows?.[0]?.id) return String(inserted.rows[0].id);
    const winner = await client.query(`SELECT id FROM distribution_contacts WHERE tenant_id=$1 AND email=$2`, [DISTRIBUTION_TENANT_ID,email.trim().toLowerCase()]);
    if (!winner.rows?.[0]?.id) throw new Error('DISTRIBUTION_CONTACT_INSERT_UNKNOWN');
    return String(winner.rows[0].id);
  });
}

const parsedQualifyLeadContactThreshold = Number.parseInt(process.env.DISTRIBUTION_QUALIFY_LEAD_CONTACT_THRESHOLD ?? '25', 10);
const QUALIFY_LEAD_CONTACT_THRESHOLD = Math.max(0, Math.min(100, Number.isFinite(parsedQualifyLeadContactThreshold) ? parsedQualifyLeadContactThreshold : 25));

export async function ingestQualifiedLead(result: Record<string, unknown>, score: number) {
  if (score < QUALIFY_LEAD_CONTACT_THRESHOLD) return { created: false, reason: 'below_contact_threshold' };
  const email = typeof result.email === 'string' ? result.email.trim().toLowerCase() : '';
  if (!validEmailAddress(email)) return { created: false, reason: 'invalid_email' };
  const company = typeof result.company === 'string' ? result.company : null;
  const sourceUrl = typeof result.url === 'string' ? result.url : null;
  // A qualify_lead job is created from a person who supplied their own email for a Free Review.
  // Default this path to consent so real signup addresses are not misclassified as researched
  // legitimate-interest role addresses. Explicit caller input still overrides the default.
  const outreachBasis = typeof result.outreachBasis === 'string' ? result.outreachBasis : 'consent';
  const consentEvidenceUrl = typeof result.consentEvidenceUrl === 'string'
    ? result.consentEvidenceUrl
    : `${PUBLIC_ORIGIN}/founder?panel=leads&leadId=${encodeURIComponent(typeof result.leadId === 'string' ? result.leadId : email)}`;
  try {
    const id = await queueContact(email, company, sourceUrl, result, outreachBasis, consentEvidenceUrl);
    return { created: true, contactId: id };
  } catch (error) {
    return { created: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function ingestResearchResult(result: Record<string, unknown>, defaultBasis: string) {
  const emails = Array.isArray(result.publicRoleEmails) ? result.publicRoleEmails.filter((v): v is string => typeof v === 'string') : [];
  const company = typeof result.company === 'string' ? result.company : null;
  const sourceUrl = typeof result.url === 'string' ? result.url : null;
  if (!emails.length) return 0;
  let queued = 0;
  for (const email of emails) {
    try { await queueContact(email, company, sourceUrl, result, defaultBasis, null); queued += 1; } catch (error) { console.error('[Distribution] contact ingestion failed:', error instanceof Error ? error.message : String(error)); }
  }
  return queued;
}

async function sendContact(contactId: string, kind: 'initial' | 'followup') {
  return withReservedOutreach(outreachDbPool, DISTRIBUTION_TENANT_ID, contactId, kind, {
    environmentLimit: DAILY_LIMIT,
    intervalMs: SEND_INTERVAL_MS,
    gate: sendGate,
    async send(client, contact, reservation, markProviderAttempt) {
      const evidence = contact.evidence && typeof contact.evidence === 'object' ? contact.evidence : {};
      let attribution: QLegionAttribution;
      if (kind === 'initial') {
        attribution = await resolveQLegionAttribution(client, typeof contact.source_url === 'string' ? contact.source_url : null);
      } else {
        const initial = await client.query(`SELECT q_legion_mission_id,q_legion_strategy_id,q_legion_strategy_probability
          FROM distribution_messages WHERE tenant_id=$1 AND contact_id=$2 AND kind='initial' AND status='sent'
          ORDER BY sent_at ASC LIMIT 1`, [DISTRIBUTION_TENANT_ID,contactId]);
        const row = initial.rows[0];
        attribution = {
          missionId: row?.q_legion_mission_id ?? null,
          strategyId: ['proof_first','revenue_first','compliance_first'].includes(String(row?.q_legion_strategy_id)) ? row.q_legion_strategy_id : 'baseline',
          probability: row?.q_legion_strategy_probability ?? null,
        };
      }
      const copy = makeCopy(String(contact.company ?? ''), evidence, kind === 'followup', attribution.strategyId);
      const brand = SPR_DEFAULT_BRAND;
      const content = { heading: copy.subject, intro: copy.intro, cta: copy.cta, outro: [`You can opt out at any time: ${unsubscribeUrl(contact.email)}`] };
      const rendered = renderBrandedEmail(brand, content);
      markProviderAttempt();
      const providerId = await sendBrandedEmail(contact.email, copy.subject, brand, content, { ...outreachSender(), idempotencyKey: reservation.id });
      const hash = crypto.createHash('sha256').update(rendered.text).digest('hex');
      const messageId = reservation.id;
      await client.query(`INSERT INTO distribution_messages
        (id,tenant_id,contact_id,kind,subject,provider_message_id,status,body_hash,sent_at,q_legion_mission_id,q_legion_strategy_id,q_legion_strategy_probability)
        VALUES ($1,$2,$3,$4,$5,$6,'sent',$7,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',$8,$9,$10)`,
        [messageId,DISTRIBUTION_TENANT_ID,contactId,kind,copy.subject,providerId,hash,attribution.missionId,attribution.strategyId,attribution.probability]);
      if (kind === 'initial') {
        await client.query(`UPDATE distribution_contacts
          SET pipeline_stage=CASE WHEN pipeline_stage IN ('new','qualified') THEN 'contacted' ELSE pipeline_stage END,
            last_contacted_at=CURRENT_TIMESTAMP, next_followup_at=CURRENT_TIMESTAMP+($2*INTERVAL '1 day'),updated_at=CURRENT_TIMESTAMP
          WHERE id=$1 AND tenant_id=$3`, [contactId,reservation.followupDelayDays,DISTRIBUTION_TENANT_ID]);
        if (attribution.missionId) await client.query(`UPDATE q_legion_missions SET mode='ACTIVE',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2`, [attribution.missionId,DISTRIBUTION_TENANT_ID]);
      } else {
        const nextDays = reservation.followupDelayDays * reservation.sequence;
        await client.query(`UPDATE distribution_contacts SET followup_count=followup_count+1,last_contacted_at=CURRENT_TIMESTAMP,
          next_followup_at=CASE WHEN followup_count+1 >= $2 THEN NULL ELSE CURRENT_TIMESTAMP+($3*INTERVAL '1 day') END,updated_at=CURRENT_TIMESTAMP
          WHERE id=$1 AND tenant_id=$4`, [contactId,reservation.maxFollowups,nextDays,DISTRIBUTION_TENANT_ID]);
      }
      return { messageId,providerId,email:contact.email,qLegion:{ ...attribution,strategyLabel:strategyLabel(attribution.strategyId) } };
    },
  });
}

export async function sendInitial(contactId: string) {
  return sendContact(contactId, 'initial');
}

export async function sendDueFollowups() {
  if (!autonomousOutreachEnabled()) return 0;
  const due = await withTenant(async (client) => client.query(`SELECT c.id FROM distribution_contacts c
    JOIN distribution_campaign_settings s ON s.tenant_id=c.tenant_id
    WHERE c.tenant_id=$1 AND c.status='active' AND s.outreach_enabled=true
      AND c.next_followup_at <= CURRENT_TIMESTAMP AND c.followup_count < s.max_followups
      AND c.pipeline_stage NOT IN ('replied','demo','checkout','pilot','customer','lost')
    ORDER BY c.next_followup_at ASC LIMIT 25`, [DISTRIBUTION_TENANT_ID]));
  let sent = 0;
  for (const row of due.rows) {
    try { await sendContact(String(row.id),'followup'); sent += 1; }
    catch (error) {
      if (error instanceof DistributionDeferredError) throw error;
      console.error('[Distribution] follow-up failed:', error instanceof Error ? error.message : String(error));
    }
  }
  return sent;
}

export async function unsubscribeContact(email: string, token: string) {
  const expected = outreachToken(email);
  if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))) throw new Error('DISTRIBUTION_UNSUBSCRIBE_TOKEN_INVALID');
  return withTenant(async (client) => {
    const result = await client.query(`UPDATE distribution_contacts SET status='unsubscribed',next_followup_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$1 AND lower(email)=lower($2) RETURNING id`, [DISTRIBUTION_TENANT_ID,email.trim()]);
    return result.rowCount > 0;
  });
}

/**
 * Sends one real message from the configured outreach address to the inbox
 * named by DISTRIBUTION_OUTREACH_VERIFY_TO, through the same renderer and
 * provider the outreach path uses, and records the provider's answer. Runs
 * once per (from, to) pair: a redeploy does not re-send. Returns what
 * happened so the caller can log it; never throws.
 */
export async function verifyOutreachSender(poolLike: { connect: () => Promise<{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>; release: () => void }> }): Promise<{ action: 'skipped' | 'sent' | 'failed'; reason?: string; providerMessageId?: string }> {
  const to = process.env.DISTRIBUTION_OUTREACH_VERIFY_TO?.trim().toLowerCase();
  const { from, replyTo } = outreachSender();
  if (!to || !from) return { action: 'skipped', reason: to ? 'DISTRIBUTION_OUTREACH_FROM not set' : 'DISTRIBUTION_OUTREACH_VERIFY_TO not set' };
  if (!autonomousOutreachEnabled()) return { action: 'skipped', reason: 'autonomous outreach disabled or email provider not configured' };
  // Several worker consumers boot at once; a session advisory lock makes the
  // check-then-send atomic across them so exactly one message goes out.
  const pool = await poolLike.connect();
  try {
  const lock = await pool.query(`SELECT pg_try_advisory_lock(hashtext('spr-outreach-sender-verification')) AS locked`);
  if (!lock.rows?.[0]?.locked) return { action: 'skipped', reason: 'another worker consumer is verifying' };
  const existing = await pool.query(`SELECT id, sent_at FROM distribution_sender_verifications WHERE lower(from_address)=lower($1) AND lower(to_address)=$2 AND status='sent' LIMIT 1`, [from, to]);
  if (existing.rows?.length) return { action: 'skipped', reason: `already verified ${new Date(existing.rows[0].sent_at).toISOString()}` };
  const id = `sv_${crypto.randomUUID().replace(/-/g, '')}`;
  try {
    const providerMessageId = await sendBrandedEmail(to, 'SPR outreach sender verification', SPR_DEFAULT_BRAND, {
      heading: 'Outreach sender verification',
      intro: [`This message was sent by the SPR distribution worker to confirm that outreach mail leaves from ${replyTo} and that replies route back to it.`, 'Reply to this message to confirm the inbox receives mail. No prospect has been contacted.'],
      outro: [`Sent ${new Date().toISOString()} by the production worker. You can opt out at any time: ${unsubscribeUrl(to)}`],
    }, { from, replyTo });
    await pool.query(`INSERT INTO distribution_sender_verifications (id, from_address, to_address, status, provider_message_id) VALUES ($1,$2,$3,'sent',$4)`, [id, from, to, providerMessageId]);
    return { action: 'sent', providerMessageId };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error);
    await pool.query(`INSERT INTO distribution_sender_verifications (id, from_address, to_address, status, error) VALUES ($1,$2,$3,'failed',$4)`, [id, from, to, message]).catch(() => undefined);
    return { action: 'failed', reason: message };
  }
  } finally {
    await pool.query(`SELECT pg_advisory_unlock(hashtext('spr-outreach-sender-verification'))`).catch(() => undefined);
    pool.release();
  }
}
