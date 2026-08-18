export type SprScope = 'read' | 'write' | 'webhooks';

export interface SprClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface RegisterSoftwareInput {
  name: string;
  version?: string;
  publisher?: string;
  category?: string;
  sourceType?: 'repository' | 'application' | 'package' | 'container' | 'api' | 'saas' | 'other';
  sourceUrl?: string | null;
  externalId?: string | null;
  licenseType?: string;
  releaseDate?: string;
  metadata?: Record<string, unknown>;
}

export class SPRApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`SPR API request failed (${status})`);
    this.name = 'SPRApiError';
  }
}

export class SPR {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly http: typeof globalThis.fetch;

  constructor(options: SprClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.sprtrust.com').replace(/\/$/, '');
    this.http = options.fetch ?? globalThis.fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.http(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new SPRApiError(response.status, body);
    return body as T;
  }

  software = {
    register: (input: RegisterSoftwareInput) => this.request<{ id: string; passportId: string; status: string }>('/api/v1/software', { method: 'POST', body: JSON.stringify(input) }),
    get: (id: string) => this.request(`/api/v1/software/${encodeURIComponent(id)}`),
  };

  passports = {
    get: (id: string) => this.request(`/api/v1/passports/${encodeURIComponent(id)}`),
    trust: (id: string) => this.request(`/api/v1/passports/${encodeURIComponent(id)}/trust`),
    evidence: (id: string) => this.request(`/api/v1/passports/${encodeURIComponent(id)}/evidence`),
    risks: (id: string) => this.request(`/api/v1/passports/${encodeURIComponent(id)}/risks`),
    history: (id: string) => this.request(`/api/v1/passports/${encodeURIComponent(id)}/history`),
  };

  webhooks = {
    create: (input: { url: string; events: string[] }) => this.request('/api/v1/webhooks', { method: 'POST', body: JSON.stringify(input) }),
    list: () => this.request('/api/v1/webhooks'),
    remove: (id: string) => this.request(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}
