/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ConnectWise Manage inbound webhook adapter.
//
// Implemented to the vendor specification supplied by the operator, NOT verified
// against a live ConnectWise instance. Two consequences are designed for rather
// than assumed away:
//
//  * The spec states the signature is "base64-encoded or hex-encoded depending
//    on the patch version of their API gateway". That is an ambiguity, not a
//    choice this code may make: guessing one encoding would reject every genuine
//    webhook from an instance using the other. The HMAC is computed once and
//    compared, in constant time, against both encodings of that same digest. An
//    attacker still needs the secret to produce either form, so accepting both
//    widens nothing.
//
//  * The spec carries no timestamp, so the signature alone cannot bound replay.
//    SPR's native scheme signs `t=<unix>,v1=<hex>` and rejects anything outside
//    a five-minute window; a bare HMAC over the body has no such property, and a
//    captured request stays valid forever. Replay is therefore handled at the
//    storage layer instead -- see the UNIQUE (endpoint_id, external_event_id)
//    constraint on psa_webhook_events, and payloadHash below for payloads that
//    carry no event id of their own.

import crypto from 'node:crypto';
import {
  type PsaAdapter,
  type PsaDisposition,
  type PsaWebhookEvent,
} from '../psa-finding-sync.ts';

export const CONNECTWISE_SIGNATURE_HEADER = 'x-cw-signature';

/** sha256 of the raw body, for de-duplicating replays of unidentified payloads. */
export const payloadHash = (rawBody: string): string =>
  crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');

const timingSafeEqualStrings = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

/**
 * HMAC-SHA256 over the raw request bytes, keyed with the tenant's unhashed
 * webhook secret. Fails closed on anything malformed.
 */
export function verifyConnectWiseSignature(secret: string, rawBody: string, header: string): boolean {
  const candidate = String(header ?? '').trim();
  if (!secret || !candidate) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const asHex = digest.toString('hex');
  const asBase64 = digest.toString('base64');
  return timingSafeEqualStrings(candidate.toLowerCase(), asHex)
    || timingSafeEqualStrings(candidate, asBase64);
}

// ConnectWise service-board statuses vary per board, so this maps only the
// vocabulary the operator can rely on. Anything unrecognised becomes 'unknown',
// which planFindingUpdate rejects as NO_CLAIM -- an unfamiliar status leaves the
// finding exactly as it was rather than being guessed into a state change.
const STATUS_DISPOSITIONS: Record<string, PsaDisposition> = {
  'closed': 'resolved_fixed',
  'resolved': 'resolved_fixed',
  'completed': 'resolved_fixed',
  'not applicable': 'resolved_not_applicable',
  'not an issue': 'resolved_not_applicable',
  'cancelled': 'resolved_not_applicable',
  'canceled': 'resolved_not_applicable',
  'reopened': 'reopened',
  'new': 'reopened',
  'acknowledged': 'acknowledged',
  'in progress': 'acknowledged',
  'assigned': 'acknowledged',
};

export function dispositionForStatus(status: unknown): PsaDisposition {
  const key = String(status ?? '').trim().toLowerCase();
  return STATUS_DISPOSITIONS[key] ?? 'unknown';
}

const firstString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
};

/**
 * Turn a verified ConnectWise body into the neutral event shape.
 *
 * Tolerant about where the fields sit, because the payload schema was not part
 * of the supplied specification, and strict about what it concludes: a status it
 * does not recognise yields 'unknown' rather than a guess.
 */
export function parseConnectWiseWebhook(rawBody: string): PsaWebhookEvent {
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ticketId: '', disposition: 'unknown', actor: 'connectwise' };
  }
  const ticket = body?.ticket ?? body?.Entity ?? body;
  return {
    ticketId: firstString(body?.ticketId, ticket?.id, ticket?.ticketId, body?.ID, body?.id),
    disposition: dispositionForStatus(ticket?.status?.name ?? ticket?.status ?? body?.status ?? body?.Action),
    actor: firstString(body?.actor, ticket?.closedBy, ticket?.owner?.identifier, body?.memberIdentifier) || 'connectwise',
    note: firstString(body?.humanReason, body?.resolutionNotes, ticket?.resolution, ticket?.summary) || undefined,
  };
}

/** External event id when ConnectWise supplies one, for replay de-duplication. */
export function externalEventId(rawBody: string): string {
  try {
    const body: any = JSON.parse(rawBody);
    return firstString(body?.eventId, body?.EventId, body?.id, body?.ID) || `sha256:${payloadHash(rawBody)}`;
  } catch {
    return `sha256:${payloadHash(rawBody)}`;
  }
}

export const connectWiseAdapter: PsaAdapter = {
  provider: 'connectwise',
  signatureHeader: CONNECTWISE_SIGNATURE_HEADER,
  parse: (rawBody) => parseConnectWiseWebhook(rawBody),
};
