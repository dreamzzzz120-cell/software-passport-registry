/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
import { z } from 'zod';

if (process.env.SKIP_DOTENV !== 'true') dotenv.config();

const trimmedString = z.preprocess((value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  return value;
}, z.string());

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  return value;
}, z.string().optional());

const optionalTrimmedUrl = z.preprocess((value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  return value;
}, z.string().url().optional());

const booleanString = z.union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')]);
const optionalBooleanString = z.optional(booleanString);
const optionalPositiveIntegerString = z.optional(z.string().regex(/^[1-9][0-9]*$/, 'Must be a positive integer'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  PORT: optionalPositiveIntegerString,
  APP_URL: optionalTrimmedUrl,
  APP_ALLOWED_ORIGINS: optionalTrimmedString,
  ENFORCE_HTTPS: optionalBooleanString,
  TRUST_PROXY: optionalBooleanString,
  ALLOW_IFRAME: optionalBooleanString,
  SQL_HOST: optionalTrimmedString,
  SQL_USER: optionalTrimmedString,
  SQL_PASSWORD: optionalTrimmedString,
  SQL_DB_NAME: optionalTrimmedString,
  DATABASE_URL: optionalTrimmedUrl,
  SQL_SSL: z.preprocess((value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    }
    return value;
  }, z.enum(['true', 'require', 'false', '1', '0']).optional()),
  SQL_POOL_MAX: optionalPositiveIntegerString,
  SQL_CONNECTION_TIMEOUT_MS: optionalPositiveIntegerString,
  SQL_IDLE_TIMEOUT_MS: optionalPositiveIntegerString,
  SQL_QUERY_TIMEOUT_MS: optionalPositiveIntegerString,
  STRIPE_SECRET_KEY: optionalTrimmedString,
  STRIPE_WEBHOOK_SECRET: optionalTrimmedString,
  GEMINI_API_KEY: optionalTrimmedString,
  FIREBASE_SERVICE_ACCOUNT_KEY: optionalTrimmedString,
  GOOGLE_APPLICATION_CREDENTIALS: optionalTrimmedString,
  SPR_INITIAL_OWNER_EMAIL: z.preprocess((value) => typeof value === 'string' ? (value.trim().toLowerCase() || undefined) : value, z.string().email().optional()),
  SPR_OWNER_BOOTSTRAP_SECRET: optionalTrimmedString,
  SPR_OWNER_BOOTSTRAP_SECRET_SHA256: z.preprocess((value) => typeof value === 'string' ? (value.trim().toLowerCase() || undefined) : value, z.string().regex(/^[a-f0-9]{64}$/).optional()),
  SENTRY_DSN: optionalTrimmedUrl,
  REDIS_URL: optionalTrimmedString,
  RATE_LIMIT_FAIL_OPEN: optionalBooleanString,
  MONITORING_ENABLED_TENANT_IDS: optionalTrimmedString,
});

const parseBoolean = (input: string | undefined, fallback: boolean) => input ? ['true', '1'].includes(input.trim().toLowerCase()) : fallback;
const parseNumber = (input: string | undefined, fallback: number) => {
  if (!input) return fallback;
  const parsed = Number(input.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const parseCsv = (input: string | undefined) => input ? input.split(',').map((item) => item.trim()).filter(Boolean) : [];

const parsedEnv = envSchema.parse(process.env);

export const config = {
  nodeEnv: parsedEnv.NODE_ENV ?? 'development',
  port: parsedEnv.PORT ? Number(parsedEnv.PORT) : 3000,
  isProduction: parsedEnv.NODE_ENV === 'production',
  appUrl: parsedEnv.APP_URL,
  allowedOrigins: parseCsv(parsedEnv.APP_ALLOWED_ORIGINS),
  enforceHttps: parseBoolean(parsedEnv.ENFORCE_HTTPS, false),
  trustProxy: parseBoolean(parsedEnv.TRUST_PROXY, false),
  allowIframe: parseBoolean(parsedEnv.ALLOW_IFRAME, false),
  database: {
    connectionString: parsedEnv.DATABASE_URL,
    host: parsedEnv.SQL_HOST,
    user: parsedEnv.SQL_USER,
    password: parsedEnv.SQL_PASSWORD,
    name: parsedEnv.SQL_DB_NAME,
    ssl: parsedEnv.SQL_SSL ? ['true', 'require'].includes(parsedEnv.SQL_SSL.toLowerCase()) : false,
    poolMax: parseNumber(parsedEnv.SQL_POOL_MAX, 20),
    connectionTimeoutMs: parseNumber(parsedEnv.SQL_CONNECTION_TIMEOUT_MS, 10000),
    idleTimeoutMs: parseNumber(parsedEnv.SQL_IDLE_TIMEOUT_MS, 30000),
    queryTimeoutMs: parseNumber(parsedEnv.SQL_QUERY_TIMEOUT_MS, 5000),
    isConfigured: Boolean(parsedEnv.DATABASE_URL || (parsedEnv.SQL_HOST && parsedEnv.SQL_USER && parsedEnv.SQL_PASSWORD && parsedEnv.SQL_DB_NAME)),
  },
  stripe: { secretKey: parsedEnv.STRIPE_SECRET_KEY, webhookSecret: parsedEnv.STRIPE_WEBHOOK_SECRET },
  gemini: { apiKey: parsedEnv.GEMINI_API_KEY },
  firebase: { serviceAccountKey: parsedEnv.FIREBASE_SERVICE_ACCOUNT_KEY, googleApplicationCredentials: parsedEnv.GOOGLE_APPLICATION_CREDENTIALS },
  ownerBootstrap: { initialOwnerEmail: parsedEnv.SPR_INITIAL_OWNER_EMAIL, secret: parsedEnv.SPR_OWNER_BOOTSTRAP_SECRET, secretSha256: parsedEnv.SPR_OWNER_BOOTSTRAP_SECRET_SHA256 },
  sentry: { dsn: parsedEnv.SENTRY_DSN },
  redis: {
    url: parsedEnv.REDIS_URL,
    // Production is always fail-closed. This flag is retained for compatibility but cannot weaken production security.
    failOpen: !((parsedEnv.NODE_ENV === 'production')) && parseBoolean(parsedEnv.RATE_LIMIT_FAIL_OPEN, false),
  },
  monitoring: { enabledTenantIds: parseCsv(parsedEnv.MONITORING_ENABLED_TENANT_IDS) },
};

export function validateConfiguration() {
  if (!config.isProduction) return;

  const missing: string[] = [];
  if (!config.appUrl) missing.push('APP_URL');
  if (!config.allowedOrigins.length) missing.push('APP_ALLOWED_ORIGINS');
  if (!config.enforceHttps) missing.push('ENFORCE_HTTPS=true');
  if (!config.trustProxy) missing.push('TRUST_PROXY=true');
  if (config.allowIframe) missing.push('ALLOW_IFRAME=false');
  if (!config.database.isConfigured) missing.push('DATABASE_URL or SQL_HOST/SQL_USER/SQL_PASSWORD/SQL_DB_NAME');
  if (!config.database.ssl) missing.push('SQL_SSL=true/require');
  if (!config.redis.url) missing.push('REDIS_URL');
  if (!config.firebase.serviceAccountKey && !config.firebase.googleApplicationCredentials) missing.push('FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS');

  const bootstrapValues = [config.ownerBootstrap.initialOwnerEmail, config.ownerBootstrap.secret, config.ownerBootstrap.secretSha256];
  if (bootstrapValues.some(Boolean) && !bootstrapValues.every(Boolean)) {
    throw new Error('Incomplete initial-owner bootstrap configuration: all three bootstrap values are required together.');
  }
  if (config.ownerBootstrap.secret && config.ownerBootstrap.secret.length < 32) {
    throw new Error('SPR_OWNER_BOOTSTRAP_SECRET must contain at least 32 characters.');
  }

  if (missing.length) throw new Error(`Production security configuration incomplete: ${missing.join(', ')}.`);

  const appOrigin = new URL(config.appUrl).origin;
  const normalizedOrigins = config.allowedOrigins.map((origin) => new URL(origin).origin);
  if (!normalizedOrigins.includes(appOrigin)) {
    throw new Error('APP_ALLOWED_ORIGINS must explicitly include APP_URL origin.');
  }
  if (normalizedOrigins.some((origin) => origin === 'null' || origin.includes('*'))) {
    throw new Error('Wildcard/null CORS origins are forbidden in production.');
  }
}

export const configurationCatalog = [
  { name: 'APP_URL', category: 'requiredProduction', requiredInProduction: true },
  { name: 'APP_ALLOWED_ORIGINS', category: 'requiredProduction', requiredInProduction: true },
  { name: 'ENFORCE_HTTPS', category: 'requiredProduction', requiredInProduction: true },
  { name: 'TRUST_PROXY', category: 'requiredProduction', requiredInProduction: true },
  { name: 'ALLOW_IFRAME', category: 'requiredProduction', requiredInProduction: true },
  { name: 'SQL_SSL', category: 'requiredProduction', requiredInProduction: true },
  { name: 'REDIS_URL', category: 'requiredProduction', requiredInProduction: true },
  { name: 'FIREBASE_SERVICE_ACCOUNT_KEY', category: 'requiredProduction', requiredInProduction: true },
  { name: 'SPR_OWNER_BOOTSTRAP_SECRET_SHA256', category: 'bootstrap-only', requiredInProduction: false },
  { name: 'STRIPE_SECRET_KEY', category: 'featureSpecific', requiredInProduction: false },
  { name: 'STRIPE_WEBHOOK_SECRET', category: 'featureSpecific', requiredInProduction: false },
  { name: 'GEMINI_API_KEY', category: 'featureSpecific', requiredInProduction: false },
  { name: 'SENTRY_DSN', category: 'optional', requiredInProduction: false },
] as const;
