/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ConnectWise Manage outbound client.
//
// This makes a real HTTP request. It deliberately has no "mock mode" and no
// simulated success path: a client that returns an invented ticket id when it
// cannot reach ConnectWise would stamp psa_ticket_id values into scan_findings
// that exist nowhere, and the inbound webhook -- which resolves tickets through
// the (tenant_id, psa_ticket_id) unique index -- would never match a single one
// of them. The failure would look like a working integration for as long as
// nobody checked ConnectWise.
//
// Testing without a ConnectWise account is handled by injecting the transport,
// so the double lives in the test file rather than in shipped code.

import { validateExternalHttpsUrl } from '../../security/hardening.ts';
import {
  ConnectWiseError,
  type ConnectWiseCredentials,
  type ConnectWiseTicket,
  type ConnectWiseTicketRequest,
} from './types.ts';

/** The subset of fetch this client uses, so tests can supply their own. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const REQUEST_TIMEOUT_MS = 15_000;

export class ConnectWiseClient {
  constructor(
    private readonly credentials: ConnectWiseCredentials,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  /**
   * ConnectWise Manage basic auth: base64("companyId+publicKey:privateKey").
   * The clientId travels separately, as its own header.
   */
  authorizationHeader(): string {
    const { companyId, publicKey, privateKey } = this.credentials;
    const token = Buffer.from(`${companyId}+${publicKey}:${privateKey}`, 'utf8').toString('base64');
    return `Basic ${token}`;
  }

  private assertUsableCredentials(): void {
    const { companyId, publicKey, privateKey, clientId, apiBaseUrl, defaultBoardId } = this.credentials;
    const missing = Object.entries({ companyId, publicKey, privateKey, clientId, apiBaseUrl, defaultBoardId })
      .filter(([, value]) => !String(value ?? '').trim())
      .map(([key]) => key);
    if (missing.length > 0) {
      throw new ConnectWiseError('CONNECTWISE_CREDENTIALS_INCOMPLETE', `Missing ConnectWise credentials: ${missing.join(', ')}.`);
    }
  }

  /**
   * The base URL is tenant-supplied, which makes it an SSRF surface: a tenant
   * that set it to http://169.254.169.254 would otherwise have SPR fetch cloud
   * metadata on its behalf, authenticated, from inside the network. It is put
   * through the same HTTPS/private-address guard the rest of the product uses.
   */
  ticketsEndpoint(): string {
    let base: URL;
    try {
      base = validateExternalHttpsUrl(this.credentials.apiBaseUrl);
    } catch (error) {
      throw new ConnectWiseError(
        'CONNECTWISE_ENDPOINT_REJECTED',
        `ConnectWise apiBaseUrl rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return new URL('/v4_6_release/apis/3.0/service/tickets', base.origin).toString();
  }

  /**
   * Open a ticket. Returns ConnectWise's own id, or throws. There is no code
   * path that returns an id ConnectWise did not supply.
   */
  async createTicket(request: ConnectWiseTicketRequest): Promise<ConnectWiseTicket> {
    this.assertUsableCredentials();
    const url = this.ticketsEndpoint();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: this.authorizationHeader(),
          clientId: this.credentials.clientId,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          summary: request.summary,
          board: { id: Number(this.credentials.defaultBoardId) },
          initialDescription: request.detail,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ConnectWiseError(
        'CONNECTWISE_REQUEST_FAILED',
        `ConnectWise request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new ConnectWiseError('CONNECTWISE_AUTH_FAILED', `ConnectWise rejected the credentials (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new ConnectWiseError('CONNECTWISE_REQUEST_FAILED', `ConnectWise returned HTTP ${response.status}.`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      throw new ConnectWiseError('CONNECTWISE_RESPONSE_UNUSABLE', 'ConnectWise returned a body that is not JSON.');
    }
    const id = (parsed as { id?: unknown })?.id;
    // A ticket without a usable id is not a ticket SPR can ever reconcile, so it
    // is a failure rather than something to record optimistically.
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      throw new ConnectWiseError('CONNECTWISE_RESPONSE_UNUSABLE', 'ConnectWise response carried no usable ticket id.');
    }
    return { id };
  }
}
