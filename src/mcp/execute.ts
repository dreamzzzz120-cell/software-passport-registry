import { resolveAgentPassport } from '../routes/public-connect.ts';
import { enforceResultLimit, hashAgentClaim, redactForAgent } from './server.ts';

function safeMcpResult(value: unknown) {
  return enforceResultLimit(redactForAgent(value));
}

export async function executePublicMcpTool(tool: string, args: Record<string, string>) {
  const passport = await resolveAgentPassport(args.passport);
  if (!passport) return safeMcpResult({ status: 'UNKNOWN', reason: 'INVALID_OR_EXPIRED_SIGNED_PASSPORT' });
  if (tool === 'verify_software' || tool === 'get_passport' || tool === 'get_trust_evidence' || tool === 'get_security_status' || tool === 'get_compliance_status' || tool === 'check_freshness') return safeMcpResult(passport);
  if (tool === 'verify_claim') {
    return safeMcpResult({ status: 'UNVERIFIED', claimHash: hashAgentClaim(args.claim), passportStatus: (passport as any).status, reason: 'SPR does not infer a claim from incomplete evidence; an explicit supporting observation is required.' });
  }
  return safeMcpResult({ status: 'UNKNOWN', reason: 'UNSUPPORTED_TOOL' });
}
