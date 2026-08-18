import crypto from 'node:crypto';

export type DeploymentProvenance = { commitSha: string; artifactSha256: string; environment: 'production' | 'staging' | 'development'; builtAt: string };

export function validateDeploymentProvenance(p: DeploymentProvenance): boolean {
  return /^[0-9a-f]{40}$/.test(p.commitSha) && /^[0-9a-f]{64}$/.test(p.artifactSha256) && ['production', 'staging', 'development'].includes(p.environment) && !Number.isNaN(Date.parse(p.builtAt));
}

export function artifactDigest(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}
