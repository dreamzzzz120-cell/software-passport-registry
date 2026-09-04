export type ConnectorFailure = {
  provider: string;
  code: string;
  retryable: boolean;
  retryAfterMs?: number;
  observedAt: string;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 8_000;

export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_BACKOFF_MS, Math.round(seconds * 1000));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.min(MAX_BACKOFF_MS, date - now));
}

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

export function backoffMs(attempt: number, retryAfter?: number, random = Math.random()): number {
  if (retryAfter !== undefined) return retryAfter;
  const exponential = Math.min(MAX_BACKOFF_MS, 250 * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.75 + Math.max(0, Math.min(1, random)) * 0.5));
}

function errorMessage(error: unknown): string {
  return String((error as any)?.message || error || 'UNKNOWN');
}

function statusFromError(message: string): number {
  return Number(message.match(/PROVIDER_HTTP_(\d{3})/)?.[1] || 0);
}

function retryAfterFromError(message: string): number | undefined {
  const value = message.match(/PROVIDER_HTTP_429:([^\s]+)/)?.[1];
  return value ? retryAfterMs(value) : undefined;
}

function isRetryableError(error: unknown): boolean {
  const message = errorMessage(error);
  return isRetryableStatus(statusFromError(message)) ||
    /PROVIDER_TIMEOUT|ECONNRESET|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET/i.test(message);
}

export async function withConnectorRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { attempts?: number; sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(5, options.attempts ?? DEFAULT_ATTEMPTS));
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === attempts) throw error;
      const message = errorMessage(error);
      await sleep(backoffMs(attempt, retryAfterFromError(message), options.random?.() ?? Math.random()));
    }
  }
  throw lastError;
}

export function classifyConnectorFailure(provider: string, error: unknown): ConnectorFailure {
  const message = errorMessage(error);
  const status = statusFromError(message);
  return {
    provider,
    code: message.split(':')[0],
    retryable: isRetryableError(error),
    retryAfterMs: status === 429 ? retryAfterFromError(message) : undefined,
    observedAt: new Date().toISOString(),
  };
}
