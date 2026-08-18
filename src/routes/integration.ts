/**
 * Backward-compatible integration router export.
 *
 * The SPR Connect implementation lives in connect.ts. Monitoring still imports
 * the historical createIntegrationRouter name, so keep this adapter rather
 * than duplicating the API-key and webhook implementation.
 */
export { createConnectRouter as createIntegrationRouter } from './connect.ts';
