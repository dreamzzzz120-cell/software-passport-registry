/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Credentials for one tenant's ConnectWise Manage instance.
 *
 * These are read from the credential vault, never from configuration: each
 * tenant connects its own ConnectWise company, so there is no deployment-wide
 * ConnectWise account and nothing here belongs in an environment variable.
 */
export interface ConnectWiseCredentials {
  /** ConnectWise company identifier, e.g. "AcmeCorp". Not SPR's tenantId. */
  companyId: string;
  /** Member API public key. */
  publicKey: string;
  /** Member API private key. Decrypted from the vault at call time. */
  privateKey: string;
  /**
   * ConnectWise integrator clientId. Required by the Manage API on every
   * request; a call without it is rejected regardless of the auth header.
   */
  clientId: string;
  /** Tenant's ConnectWise site, e.g. "https://api-eu.myconnectwise.net". */
  apiBaseUrl: string;
  /** Service board that security findings are filed to. */
  defaultBoardId: string;
}

/** A ticket SPR asks ConnectWise to open for a finding. */
export interface ConnectWiseTicketRequest {
  summary: string;
  detail: string;
}

/** What ConnectWise returned. `id` is ConnectWise's own ticket number. */
export interface ConnectWiseTicket {
  id: number;
}

export type ConnectWiseFailureCode =
  | 'CONNECTWISE_CREDENTIALS_INCOMPLETE'
  | 'CONNECTWISE_ENDPOINT_REJECTED'
  | 'CONNECTWISE_AUTH_FAILED'
  | 'CONNECTWISE_REQUEST_FAILED'
  | 'CONNECTWISE_RESPONSE_UNUSABLE';

export class ConnectWiseError extends Error {
  constructor(readonly code: ConnectWiseFailureCode, message: string) {
    super(message);
    this.name = 'ConnectWiseError';
  }
}
