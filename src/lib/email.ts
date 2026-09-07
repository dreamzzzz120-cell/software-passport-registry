/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Direct transactional email send.
 *
 * Most product email goes through notification_outbox, which the worker drains
 * with retry, backoff and last_error recording. That path needs a tenant_id,
 * and the one case that cannot supply one is the email a brand-new account
 * needs before it has been provisioned into a workspace: its verification
 * link. This sends those immediately instead of queueing them.
 *
 * src/workers/notification-worker.ts has its own copy of this call for the
 * queued path. Folding the two together means touching the worker, so it is
 * deliberately left for a separate change rather than bundled in here.
 */

export function isEmailProviderConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export async function sendEmailDirect(
  destination: string,
  subject: string,
  body: string
): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [destination], subject, text: body }),
  });
  const result = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) {
    throw new Error(`EMAIL_PROVIDER_${response.status}:${result?.message ?? 'unknown'}`);
  }
  return result?.id ?? '';
}
