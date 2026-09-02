/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
import { z } from 'zod';

if (process.env.NODE_ENV !== 'production' && process.env.SKIP_DOTENV !== 'true') dotenv.config();

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
    if (trimmed.length === 0) return undefined;
    try { new URL(trimmed); return trimmed; } catch { return undefined; }
  }
  return value;
}, z.string().url().optional());

const booleanString = z.union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')]);
const optionalBooleanString = z.optional(booleanString);
const optionalPositiveIntegerString = z.optional(z.string().regex(/^[1-9][0-9]*$/, 'Must be a positive integer'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(), PORT: optionalPositiveIntegerString,
  APP_URL: optionalTrimmedUrl, APP_ALLOWED_ORIGINS: optionalTrimmedString,
  ENFORCE_HTTPS: optionalBooleanString, TRUST_PROXY: optionalBooleanString, ALLOW_IFRAME: optionalBooleanString,
  SQL_HOST: optionalTrimmedString, SQL_USER: optionalTrimmedString, SQL_PASSWORD: optionalTrimmedString, SQL_DB_NAME: optionalTrimmedString,
  DATABASE_URL: optionalTrimmedUrl,
  APP_DATABASE_URL: optionalTrimmedUrl, WORKER_DATABASE_URL: optionalTrimmedUrl,
  SQL_SSL: z.preprocess((value) => typeof value === 'string' ? (value.trim() || undefined) : value, z.enum(['true', 'require', 'verify', 'verify-full', 'false', '1', '0']).optional()),
  SQL_SSL_CA: optionalTrimmedString,
  SQL_POOL_MAX: optionalPositiveIntegerString, SQL_CONNECTION_TIMEOUT_MS: optionalPositiveIntegerString, SQL_IDLE_TIMEOUT_MS: optionalPositiveIntegerString, SQL_QUERY_TIMEOUT_MS: optionalPositiveIntegerString,
  FIREBASE_PROJECT_ID: optionalTrimmedString, FIREBASE_SERVICE_ACCOUNT_KEY: optionalTrimmedString, FIREBASE_SERVICE_ACCOUNT_KEY_B64: optionalTrimmedString, GOOGLE_APPLICATION_CREDENTIALS: optionalTrimmedString,
  STRIPE_SECRET_KEY: optionalTrimmedString, STRIPE_WEBHOOK_SECRET: optionalTrimmedString,
  STRIPE_PRICE_PILOT: optionalTrimmedString, STRIPE_PRICE_STARTER: optionalTrimmedString, STRIPE_PRICE_PROFESSIONAL: optionalTrimmedString, STRIPE_PRICE_GROWTH: optionalTrimmedString, STRIPE_PRICE_ENTERPRISE: optionalTrimmedString,
  STRIPE_PRICE_MSP_PILOT: optionalTrimmedString, STRIPE_PRICE_MSP_GROWTH: optionalTrimmedString, STRIPE_PRICE_MSP_SCALE: optionalTrimmedString,
  STRIPE_PRICE_SOFTWARE_PASSPORT: optionalTrimmedString, STRIPE_PRICE_EVIDENCE_REPORT: optionalTrimmedString, STRIPE_PRICE_SECURITY_ASSESSMENT: optionalTrimmedString,
  STRIPE_PRICE_VERIFIED_SYSTEM_REPORT: optionalTrimmedString, STRIPE_PRICE_DUE_DILIGENCE_REPORT: optionalTrimmedString, STRIPE_PRICE_VENDOR_RISK_ASSESSMENT: optionalTrimmedString,
  STRIPE_PRICE_SBOM_ANALYSIS: optionalTrimmedString, STRIPE_PRICE_PORTFOLIO_ASSESSMENT: optionalTrimmedString, STRIPE_PRICE_AUDIT_EVIDENCE_PACKAGE: optionalTrimmedString, STRIPE_PRICE_CUSTOM_ASSESSMENT: optionalTrimmedString,
  STRIPE_PRICE_CONTINUOUS_VERIFICATION: optionalTrimmedString, STRIPE_PRICE_TRUST_BADGE: optionalTrimmedString, STRIPE_PRICE_PUBLIC_PASSPORT: optionalTrimmedString, STRIPE_PRICE_API: optionalTrimmedString,
  GEMINI_API_KEY: optionalTrimmedString, GOOGLE_GENAI_API_KEY: optionalTrimmedString, AI_GATEWAY_API_KEY: optionalTrimmedString,
  SPR_INITIAL_OWNER_EMAIL: z.preprocess((value) => typeof value === 'string' ? (value.trim().toLowerCase() || undefined) : value, z.string().email().optional()),
  SPR_OWNER_BOOTSTRAP_SECRET: optionalTrimmedString,
  SPR_OWNER_BOOTSTRAP_SECRET_SHA256: z.preprocess((value) => typeof value === 'string' ? (value.trim().toLowerCase() || undefined) : value, z.string().regex(/^[a-f0-9]{64}$/).optional()),
  SPR_PUBLIC_PASSPORT_SECRET: optionalTrimmedString,
  SENTRY_DSN: optionalTrimmedUrl, REDIS_URL: optionalTrimmedString, RATE_LIMIT_FAIL_OPEN: optionalBooleanString, MONITORING_ENABLED_TENANT_IDS: optionalTrimmedString,
});

const parseBoolean = (input: string | undefined, fallback: boolean) => input ? ['true', '1'].includes(input.trim().toLowerCase()) : fallback;
const parseNumber = (input: string | undefined, fallback: number) => { const parsed = input ? Number(input.trim()) : NaN; return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; };
const parseCsv = (input: string | undefined) => input ? input.split(',').map((item) => item.trim()).filter(Boolean) : [];
const normalizeOrigin = (origin: string) => new URL(origin).origin;
const parseOriginList = (input: string | undefined) => parseCsv(input).map(normalizeOrigin);
const parsedEnv = envSchema.parse(process.env);

const railwayPublicUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}` : undefined;
const effectiveAppUrl = parsedEnv.APP_URL ?? railwayPublicUrl;
const effectiveAllowedOrigins = [...new Set([
  ...parseOriginList(parsedEnv.APP_ALLOWED_ORIGINS),
  'https://software-passport-registry-vercel.vercel.app',
])];

const sslMode = parsedEnv.SQL_SSL?.toLowerCase();
const databaseSslEnabled = Boolean(sslMode && !['false', '0'].includes(sslMode));
const databaseSslVerification = sslMode === 'verify' || sslMode === 'verify-full' || Boolean(parsedEnv.SQL_SSL_CA);

export const config = {
  nodeEnv: parsedEnv.NODE_ENV ?? 'development', port: parsedEnv.PORT ? Number(parsedEnv.PORT) : 3000, isProduction: parsedEnv.NODE_ENV === 'production',
  appUrl: effectiveAppUrl, allowedOrigins: effectiveAllowedOrigins, enforceHttps: parseBoolean(parsedEnv.ENFORCE_HTTPS, false), trustProxy: parseBoolean(parsedEnv.TRUST_PROXY, false), allowIframe: parseBoolean(parsedEnv.ALLOW_IFRAME, false),
  database: {
    connectionString: parsedEnv.DATABASE_URL, host: parsedEnv.SQL_HOST, user: parsedEnv.SQL_USER, password: parsedEnv.SQL_PASSWORD, name: parsedEnv.SQL_DB_NAME,
    appConnectionString: parsedEnv.APP_DATABASE_URL ?? parsedEnv.DATABASE_URL,
    workerConnectionString: parsedEnv.WORKER_DATABASE_URL ?? parsedEnv.DATABASE_URL,
    ssl: databaseSslEnabled,
    sslVerify: databaseSslVerification,
    sslCa: parsedEnv.SQL_SSL_CA,
    poolMax: parseNumber(parsedEnv.SQL_POOL_MAX, 20), connectionTimeoutMs: parseNumber(parsedEnv.SQL_CONNECTION_TIMEOUT_MS, 10000), idleTimeoutMs: parseNumber(parsedEnv.SQL_IDLE_TIMEOUT_MS, 30000), queryTimeoutMs: parseNumber(parsedEnv.SQL_QUERY_TIMEOUT_MS, 5000),
    isConfigured: Boolean(parsedEnv.DATABASE_URL || (parsedEnv.SQL_HOST && parsedEnv.SQL_USER && parsedEnv.SQL_PASSWORD && parsedEnv.SQL_DB_NAME)),
  },
  firebase: { projectId: parsedEnv.FIREBASE_PROJECT_ID, serviceAccountKey: parsedEnv.FIREBASE_SERVICE_ACCOUNT_KEY, serviceAccountKeyB64: parsedEnv.FIREBASE_SERVICE_ACCOUNT_KEY_B64, googleApplicationCredentials: parsedEnv.GOOGLE_APPLICATION_CREDENTIALS },
  stripe: {
    secretKey: parsedEnv.STRIPE_SECRET_KEY, webhookSecret: parsedEnv.STRIPE_WEBHOOK_SECRET,
    prices: {
      pilot: parsedEnv.STRIPE_PRICE_MSP_PILOT ?? parsedEnv.STRIPE_PRICE_PILOT,
      starter: parsedEnv.STRIPE_PRICE_STARTER,
      professional: parsedEnv.STRIPE_PRICE_MSP_GROWTH ?? parsedEnv.STRIPE_PRICE_PROFESSIONAL,
      growth: parsedEnv.STRIPE_PRICE_MSP_SCALE ?? parsedEnv.STRIPE_PRICE_GROWTH,
      enterprise: parsedEnv.STRIPE_PRICE_ENTERPRISE,
      mspPilot: parsedEnv.STRIPE_PRICE_MSP_PILOT,
      mspGrowth: parsedEnv.STRIPE_PRICE_MSP_GROWTH,
      mspScale: parsedEnv.STRIPE_PRICE_MSP_SCALE,
      softwarePassport: parsedEnv.STRIPE_PRICE_SOFTWARE_PASSPORT,
      evidenceReport: parsedEnv.STRIPE_PRICE_EVIDENCE_REPORT,
      securityAssessment: parsedEnv.STRIPE_PRICE_SECURITY_ASSESSMENT,
      verifiedSystemReport: parsedEnv.STRIPE_PRICE_VERIFIED_SYSTEM_REPORT,
      dueDiligenceReport: parsedEnv.STRIPE_PRICE_DUE_DILIGENCE_REPORT,
      vendorRiskAssessment: parsedEnv.STRIPE_PRICE_VENDOR_RISK_ASSESSMENT,
      sbomAnalysis: parsedEnv.STRIPE_PRICE_SBOM_ANALYSIS,
      portfolioAssessment: parsedEnv.STRIPE_PRICE_PORTFOLIO_ASSESSMENT,
      auditEvidencePackage: parsedEnv.STRIPE_PRICE_AUDIT_EVIDENCE_PACKAGE,
      customAssessment: parsedEnv.STRIPE_PRICE_CUSTOM_ASSESSMENT,
      continuousVerification: parsedEnv.STRIPE_PRICE_CONTINUOUS_VERIFICATION,
      trustBadge: parsedEnv.STRIPE_PRICE_TRUST_BADGE,
      publicPassport: parsedEnv.STRIPE_PRICE_PUBLIC_PASSPORT,
      api: parsedEnv.STRIPE_PRICE_API,
    },
  },
  gemini: { apiKey: parsedEnv.GEMINI_API_KEY ?? parsedEnv.GOOGLE_GENAI_API_KEY }, aiGateway: { apiKey: parsedEnv.AI_GATEWAY_API_KEY },
  ownerBootstrap: { initialOwnerEmail: parsedEnv.SPR_INITIAL_OWNER_EMAIL, secret: parsedEnv.SPR_OWNER_BOOTSTRAP_SECRET, secretSha256: parsedEnv.SPR_OWNER_BOOTSTRAP_SECRET_SHA256 },
  publicPassport: { secret: parsedEnv.SPR_PUBLIC_PASSPORT_SECRET },
  sentry: { dsn: parsedEnv.SENTRY_DSN }, redis: { url: parsedEnv.REDIS_URL, failOpen: parsedEnv.NODE_ENV !== 'production' && parseBoolean(parsedEnv.RATE_LIMIT_FAIL_OPEN, false) }, monitoring: { enabledTenantIds: parseCsv(parsedEnv.MONITORING_ENABLED_TENANT_IDS) },
};

export function validateConfiguration() {
  if (!config.isProduction) return;
  const missing: string[] = [];
  if (!config.appUrl) missing.push('APP_URL or RAILWAY_PUBLIC_DOMAIN');
  if (!config.allowedOrigins.length) missing.push('APP_ALLOWED_ORIGINS');
  if (!config.enforceHttps) missing.push('ENFORCE_HTTPS=true');
  if (!config.trustProxy) missing.push('TRUST_PROXY=true');
  if (config.allowIframe) missing.push('ALLOW_IFRAME=false');
  if (!config.database.isConfigured) missing.push('DATABASE_URL or SQL_HOST/SQL_USER/SQL_PASSWORD/SQL_DB_NAME');
  // appConnectionString falls back to DATABASE_URL, so an unset APP_DATABASE_URL would
  // silently reconnect the whole HTTP API as the owner role -- which is BYPASSRLS -- with
  // no error and no readiness failure. Tenant isolation must not degrade quietly.
  if (!parsedEnv.APP_DATABASE_URL) missing.push('APP_DATABASE_URL (least-privileged spr_app_runtime connection; without it the API would run as the owner role and bypass RLS)');
  if (!config.database.ssl) missing.push('SQL_SSL=true/require/verify/verify-full');
  if (config.database.sslVerify && !config.database.sslCa && !['verify-full', 'verify'].includes(parsedEnv.SQL_SSL ?? '')) missing.push('SQL_SSL_CA for certificate verification');
  if (!config.redis.url) missing.push('REDIS_URL');
  if (!config.firebase.serviceAccountKey && !config.firebase.serviceAccountKeyB64 && !config.firebase.googleApplicationCredentials) missing.push('FIREBASE_SERVICE_ACCOUNT_KEY, FIREBASE_SERVICE_ACCOUNT_KEY_B64, or GOOGLE_APPLICATION_CREDENTIALS');
  if (!config.publicPassport.secret || config.publicPassport.secret.length < 32) missing.push('SPR_PUBLIC_PASSPORT_SECRET (32+ characters)');
  const bootstrapValues = [config.ownerBootstrap.initialOwnerEmail, config.ownerBootstrap.secret, config.ownerBootstrap.secretSha256];
  if (bootstrapValues.some(Boolean) && !bootstrapValues.every(Boolean)) throw new Error('Incomplete initial-owner bootstrap configuration: all three bootstrap values are required together.');
  if (config.ownerBootstrap.secret && config.ownerBootstrap.secret.length < 32) throw new Error('SPR_OWNER_BOOTSTRAP_SECRET must contain at least 32 characters.');
  if (missing.length) throw new Error(`Production security configuration incomplete: ${missing.join(', ')}.`);
  const appUrl = config.appUrl;
  if (!appUrl) throw new Error('APP_URL or RAILWAY_PUBLIC_DOMAIN is required in production.');
  const appOrigin = normalizeOrigin(appUrl);
  if (!config.allowedOrigins.includes(appOrigin)) throw new Error('APP_ALLOWED_ORIGINS must explicitly include APP_URL origin.');
  if (config.allowedOrigins.some((origin) => origin === 'null' || origin.includes('*'))) throw new Error('Wildcard/null CORS origins are forbidden in production.');
}

export const configurationCatalog = [
  { name: 'APP_URL', category: 'requiredProduction', requiredInProduction: true }, { name: 'APP_ALLOWED_ORIGINS', category: 'requiredProduction', requiredInProduction: true },
  { name: 'ENFORCE_HTTPS', category: 'requiredProduction', requiredInProduction: true }, { name: 'TRUST_PROXY', category: 'requiredProduction', requiredInProduction: true },
  { name: 'ALLOW_IFRAME', category: 'requiredProduction', requiredInProduction: true }, { name: 'SQL_SSL', category: 'requiredProduction', requiredInProduction: true },
  { name: 'SQL_SSL_CA', category: 'requiredWhenVerificationIsEnabled', requiredInProduction: false }, { name: 'REDIS_URL', category: 'requiredProduction', requiredInProduction: true }, { name: 'FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_SERVICE_ACCOUNT_KEY_B64', category: 'requiredProduction', requiredInProduction: true },
  { name: 'SPR_PUBLIC_PASSPORT_SECRET', category: 'requiredProduction', requiredInProduction: true },
  { name: 'AI_GATEWAY_API_KEY', category: 'featureSpecific', requiredInProduction: false }, { name: 'SPR_OWNER_BOOTSTRAP_SECRET_SHA256', category: 'bootstrap-only', requiredInProduction: false },
  { name: 'STRIPE_SECRET_KEY', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_WEBHOOK_SECRET', category: 'featureSpecific', requiredInProduction: false },
  { name: 'STRIPE_PRICE_MSP_PILOT', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_MSP_GROWTH', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_MSP_SCALE', category: 'featureSpecific', requiredInProduction: false },
  { name: 'STRIPE_PRICE_SOFTWARE_PASSPORT', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_EVIDENCE_REPORT', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_SECURITY_ASSESSMENT', category: 'featureSpecific', requiredInProduction: false },
  { name: 'STRIPE_PRICE_VERIFIED_SYSTEM_REPORT', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_DUE_DILIGENCE_REPORT', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_VENDOR_RISK_ASSESSMENT', category: 'featureSpecific', requiredInProduction: false },
  { name: 'STRIPE_PRICE_SBOM_ANALYSIS', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_PORTFOLIO_ASSESSMENT', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_AUDIT_EVIDENCE_PACKAGE', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_CUSTOM_ASSESSMENT', category: 'featureSpecific', requiredInProduction: false },
  { name: 'STRIPE_PRICE_CONTINUOUS_VERIFICATION', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_TRUST_BADGE', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_PUBLIC_PASSPORT', category: 'featureSpecific', requiredInProduction: false }, { name: 'STRIPE_PRICE_API', category: 'featureSpecific', requiredInProduction: false },
  { name: 'GEMINI_API_KEY', category: 'featureSpecific', requiredInProduction: false }, { name: 'SENTRY_DSN', category: 'optional', requiredInProduction: false },
] as const;
