/**
 * Credential fields required by each provider's real, authenticated collector.
 * Every provider here except `github` is read by collectProviderEvidence in
 * src/integrations/adapters.ts, tested via POST /api/integrations-live/:provider/test,
 * and kept in lockstep with that file's `credentials.xyz` reads — if a field
 * is added there, add it here too, or the connect form will silently fail the
 * live test with CREDENTIAL_MISSING.
 *
 * `github` is read by the separate deep collector, collectGitHubDeepEvidence
 * (src/integrations/github-deep.ts), and tested via POST /api/trust-loop/collect
 * instead — its evidence shape (many ControlObservations) doesn't fit the
 * generic adapter's single-observation contract, so it is intentionally not
 * routed through /api/integrations-live/:provider/test.
 */
export type CredentialField = { key: string; label: string; type: 'text' | 'password' | 'textarea'; required: boolean; placeholder?: string };

export const CREDENTIAL_FIELDS: Record<string, CredentialField[]> = {
  github: [
    { key: 'accessToken', label: 'Personal access token', type: 'password', required: true, placeholder: 'ghp_...' },
  ],
  gitlab: [
    { key: 'accessToken', label: 'Personal access token', type: 'password', required: true },
    { key: 'baseUrl', label: 'Base URL (self-hosted only)', type: 'text', required: false, placeholder: 'https://gitlab.com' },
  ],
  bitbucket: [
    { key: 'accessToken', label: 'App password / access token', type: 'password', required: true },
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: false, placeholder: 'https://api.bitbucket.org/2.0' },
  ],
  'azure-devops': [
    { key: 'organization', label: 'Organization', type: 'text', required: true, placeholder: 'my-org' },
    { key: 'accessToken', label: 'Personal access token', type: 'password', required: true },
  ],
  jira: [
    { key: 'baseUrl', label: 'Site URL', type: 'text', required: true, placeholder: 'https://yourcompany.atlassian.net' },
    { key: 'email', label: 'Account email', type: 'text', required: true },
    { key: 'apiToken', label: 'API token', type: 'password', required: true },
  ],
  confluence: [
    { key: 'baseUrl', label: 'Site URL', type: 'text', required: true, placeholder: 'https://yourcompany.atlassian.net' },
    { key: 'email', label: 'Account email', type: 'text', required: true },
    { key: 'apiToken', label: 'API token', type: 'password', required: true },
  ],
  slack: [
    { key: 'accessToken', label: 'Bot token', type: 'password', required: true, placeholder: 'xoxb-...' },
  ],
  'microsoft-365': [
    { key: 'accessToken', label: 'Microsoft Graph access token', type: 'password', required: true },
  ],
  aws: [
    { key: 'accessKeyId', label: 'Access key ID', type: 'text', required: true },
    { key: 'secretAccessKey', label: 'Secret access key', type: 'password', required: true },
    { key: 'region', label: 'Region', type: 'text', required: false, placeholder: 'us-east-1' },
    { key: 'sessionToken', label: 'Session token (temporary credentials only)', type: 'password', required: false },
  ],
  azure: [
    { key: 'subscriptionId', label: 'Subscription ID', type: 'text', required: true },
    { key: 'accessToken', label: 'Azure Resource Manager access token', type: 'password', required: true },
  ],
  'google-cloud': [
    // A service-account key is signed into a short-lived access token
    // server-side (adapters.ts: mintGoogleServiceAccountAccessToken) rather
    // than used directly, since Google's IAM token itself expires hourly and
    // isn't something a real user has lying around to paste in.
    { key: 'serviceAccountKey', label: 'Service account JSON key', type: 'textarea', required: true, placeholder: '{"type":"service_account","project_id":"...","private_key":"...","client_email":"...ACCOUNT@PROJECT.iam.gserviceaccount.com",...}' },
  ],
  connectwise: [
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, placeholder: 'https://api-na.myconnectwise.net' },
    { key: 'companyId', label: 'Company ID', type: 'text', required: true },
    { key: 'publicKey', label: 'Public key', type: 'text', required: true },
    { key: 'privateKey', label: 'Private key', type: 'password', required: true },
  ],
  autotask: [
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: true },
    { key: 'username', label: 'API username', type: 'text', required: true },
    { key: 'secret', label: 'Secret', type: 'password', required: true },
    { key: 'integrationCode', label: 'Integration code', type: 'text', required: true },
  ],
  ninjaone: [
    { key: 'accessToken', label: 'Access token', type: 'password', required: true },
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: false, placeholder: 'https://app.ninjarmm.com' },
  ],
  hudu: [
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: true },
    { key: 'apiKey', label: 'API key', type: 'password', required: true },
  ],
};

export const WEBHOOK_EVENT_TYPES = ['passport.updated', 'trust.changed', 'risk.created', 'risk.resolved', 'evidence.updated', 'verification.completed', 'verification.expired'] as const;
