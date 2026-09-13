import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, appPool } from '../db/index.ts';
import { renderBrandedEmail, SPR_DEFAULT_BRAND, sendBrandedEmail } from './branded-email.ts';
import { DISTRIBUTION_TENANT_ID } from './distribution-engine.ts';

const PUBLIC_ORIGIN = 'https://www.softwarepassportregistry.com';
const DAILY_LIMIT = Math.max(1, Math.min(500, Number.parseInt(process.env.DISTRIBUTION_DAILY_SEND_LIMIT ?? '50', 10) || 50));
const FOLLOWUP_DAYS = Math.max(1, Math.min(30, Number.parseInt(process.env.DISTRIBUTION_FOLLOWUP_DAYS ?? '5', 10) || 5));
const MAX_FOLLOWUPS = Math.max(0, Math.min(3, Number.parseInt(process.env.DISTRIBUTION_MAX_FOLLOWUPS ?? '2', 10) || 2));

export function autonomousOutreachEnabled() {
  return process.env.DISTRIBUTION_AUTONOMOUS_OUTREACH === 'true' && Boolean(process.env.RESEND_API_KEY?.trim()) && Boolean(process.env.EMAIL_FROM?.trim());
}

function outreachAllowed(payload: Record<string, unknown>) {
  if (!autonomousOutreachEnabled()) throw new Error('DISTRIBUTION_AUTONOMOUS_OUTREACH_DISABLED');
  if (payload.outreachBasis !== 'consent' && payload.outreachBasis !== 'legitimate_interest') throw new Error('DISTRIBUTION_OUTREACH_BASIS_REQUIRED');
  if (payload.outreachBasis === 'legitimate_interest' && process.env.DISTRIBUTION_LI_ATTESTED !== 'true') throw new Error('DISTRIBUTION_LI_ATTESTATION_REQUIRED');
}

export function outreachToken(email: string) {
  const secret = process.env.PUBLIC_PASSPORT_SECRET?.trim();
  if (!secret) throw new Error('PUBLIC_PASSPORT_SECRET_REQUIRED');
  return crypto.createHmac('sha256', secret).update(`distribution-unsubscribe-v1:${email.trim().toLowerCase()}`).digest('hex').slice(0, 48);
}

export function unsubscribeUrl(email: string) {
  return `${PUBLIC_ORIGIN}/api/public/distribution/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(outreachToken(email))}`;
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

function makeCopy(company: string, evidence: Record<string, unknown>, followup: boolean) {
  const signals = evidence.signals && typeof evidence.signals === 'object' ? evidence.signals as Record<string, unknown> : {};
  const focus = signals.compliance ? 'client software and vendor risk evidence' : signals.cybersecurity ? 'software security and vendor risk' : 'software trust and verification';
  const greeting = company ? `Hi ${company} team,` : 'Hi there,';
  if (followup) return { subject: `Following up — ${focus}`, intro: [greeting, `I wanted to follow up on my note about SPR for ${focus}. It gives MSPs an evidence-first way to verify software, document findings, and produce client-ready trust reports.`, 'If this is relevant, I can point you straight to the free repo review. If not, no worries.'], cta: { label: 'Run a free repo review', url: `${PUBLIC_ORIGIN}/` } };
  return { subject: `Software trust for ${company || 'your MSP clients'}`, intro: [greeting, `I came across your business while researching MSPs and IT/security providers. SPR is built for ${focus}, with the evidence retained behind every result.`, 'There is a free repo review so you can see the workflow before buying anything.'], cta: { label: 'Run a free repo review', url: `${PUBLIC_ORIGIN}/` } };
}

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

async function dailySendCount(client: any) {
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM distribution_messages WHERE tenant_id=$1 AND status='sent' AND created_at >= CURRENT_DATE`, [DISTRIBUTION_TENANT_ID]);
  return Number(result.rows?.[0]?.count ?? 0);
}

export async function queueContact(email: string, company: string | null, sourceUrl: string | null, evidence: Record<string, unknown>, outreachBasis: string, consentEvidenceUrl: string | null) {
  if (!validRoleAddress(email)) throw new Error('DISTRIBUTION_ROLE_EMAIL_REQUIRED');
  if (!['consent','legitimate_interest'].includes(outreachBasis)) throw new Error('DISTRIBUTION_OUTREACH_BASIS_INVALID');
  const id = `dc_${crypto.randomUUID().replace(/-/g, '')}`;
  return withTenant(async (client) => {
    const existing = await client.query(`SELECT id FROM distribution_contacts WHERE tenant_id=$1 AND lower(email)=lower($2) LIMIT 1`, [DISTRIBUTION_TENANT_ID, email.trim()]);
    if (existing.rows?.[0]?.id) return String(existing.rows[0].id);
    await client.query(`INSERT INTO distribution_contacts (id,tenant_id,email,company,source_url,evidence,outreach_basis,consent_evidence_url) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`, [id,DISTRIBUTION_TENANT_ID,email.trim().toLowerCase(),company,sourceUrl,JSON.stringify(evidence),outreachBasis,consentEvidenceUrl]);
    return id;
  });
}

export async function sendInitial(contactId: string) {
  outreachAllowed({ outreachBasis: 'legitimate_interest' });
  return withTenant(async (client) => {
    if (await dailySendCount(client) >= DAILY_LIMIT) throw new Error('DISTRIBUTION_DAILY_SEND_LIMIT_REACHED');
    const contactResult = await client.query(`SELECT id,email,company,evidence,status,outreach_basis,consent_evidence_url,last_contacted_at FROM distribution_contacts WHERE id=$1 AND tenant_id=$2 LIMIT 1`, [contactId,DISTRIBUTION_TENANT_ID]);
    const contact = contactResult.rows?.[0];
    if (!contact || contact.status !== 'active') throw new Error('DISTRIBUTION_CONTACT_NOT_ACTIVE');
    if (!contact.outreach_basis) throw new Error('DISTRIBUTION_OUTREACH_BASIS_REQUIRED');
    const already = await client.query(`SELECT 1 FROM distribution_messages WHERE contact_id=$1 AND kind='initial' AND status='sent' LIMIT 1`, [contactId]);
    if (already.rows?.length) throw new Error('DISTRIBUTION_INITIAL_ALREADY_SENT');
    const evidence = contact.evidence && typeof contact.evidence === 'object' ? contact.evidence : {};
    const copy = makeCopy(String(contact.company ?? ''), evidence, false);
    const brand = SPR_DEFAULT_BRAND;
    const rendered = renderBrandedEmail(brand, { heading: copy.subject, intro: copy.intro, cta: copy.cta, outro: [`You can opt out at any time: ${unsubscribeUrl(contact.email)}`] });
    const providerId = await sendBrandedEmail(contact.email, copy.subject, brand, { heading: copy.subject, intro: copy.intro, cta: copy.cta, outro: [`You can opt out at any time: ${unsubscribeUrl(contact.email)}`] });
    const hash = crypto.createHash('sha256').update(rendered.text).digest('hex');
    const messageId = `dm_${crypto.randomUUID().replace(/-/g, '')}`;
    await client.query(`INSERT INTO distribution_messages (id,tenant_id,contact_id,kind,subject,provider_message_id,status,body_hash,sent_at) VALUES ($1,$2,$3,'initial',$4,$5,'sent',$6,CURRENT_TIMESTAMP)`, [messageId,DISTRIBUTION_TENANT_ID,contactId,copy.subject,providerId,hash]);
    await client.query(`UPDATE distribution_contacts SET last_contacted_at=CURRENT_TIMESTAMP,next_followup_at=CURRENT_TIMESTAMP + ($2 * INTERVAL '1 day'),updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [contactId,FOLLOWUP_DAYS]);
    return { messageId, providerId, email: contact.email };
  });
}

export async function sendDueFollowups() {
  if (!autonomousOutreachEnabled()) return 0;
  let sent = 0;
  const due = await db.execute(sql`SELECT c.id FROM distribution_contacts c WHERE c.tenant_id=${DISTRIBUTION_TENANT_ID} AND c.status='active' AND c.next_followup_at <= CURRENT_TIMESTAMP AND c.followup_count < ${MAX_FOLLOWUPS} ORDER BY c.next_followup_at ASC LIMIT 25`);
  for (const row of ((due as any).rows ?? [])) {
    try {
      outreachAllowed({ outreachBasis: 'legitimate_interest' });
      await withTenant(async (client) => {
        if (await dailySendCount(client) >= DAILY_LIMIT) throw new Error('DISTRIBUTION_DAILY_SEND_LIMIT_REACHED');
        const result = await client.query(`SELECT id,email,company,evidence,followup_count FROM distribution_contacts WHERE id=$1 AND tenant_id=$2 AND status='active' LIMIT 1`, [row.id,DISTRIBUTION_TENANT_ID]);
        const contact = result.rows?.[0]; if (!contact) return;
        const copy = makeCopy(String(contact.company ?? ''), contact.evidence ?? {}, true);
        const brand = SPR_DEFAULT_BRAND;
        const providerId = await sendBrandedEmail(contact.email, copy.subject, brand, { heading: copy.subject, intro: copy.intro, cta: copy.cta, outro: [`You can opt out at any time: ${unsubscribeUrl(contact.email)}`] });
        const messageId = `dm_${crypto.randomUUID().replace(/-/g, '')}`;
        await client.query(`INSERT INTO distribution_messages (id,tenant_id,contact_id,kind,subject,provider_message_id,status,sent_at) VALUES ($1,$2,$3,'followup',$4,$5,'sent',CURRENT_TIMESTAMP)`, [messageId,DISTRIBUTION_TENANT_ID,contact.id,copy.subject,providerId]);
        const nextDays = FOLLOWUP_DAYS * (Number(contact.followup_count) + 1);
        await client.query(`UPDATE distribution_contacts SET followup_count=followup_count+1,last_contacted_at=CURRENT_TIMESTAMP,next_followup_at=CASE WHEN followup_count+1 >= $2 THEN NULL ELSE CURRENT_TIMESTAMP + ($3 * INTERVAL '1 day') END,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [contact.id,MAX_FOLLOWUPS,nextDays]);
        sent += 1;
      });
    } catch (error) { console.error('[Distribution] follow-up failed:', error instanceof Error ? error.message : String(error)); }
  }
  return sent;
}
