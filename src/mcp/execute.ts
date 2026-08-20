import { resolveAgentPassport } from '../routes/public-connect.ts';
import { hashAgentClaim } from './server.ts';

export async function executePublicMcpTool(tool: string, args: Record<string, string>) {
  const passport = await resolveAgentPassport(args.passport);
  if (!passport) return { status: 'UNKNOWN', reason: 'INVALID_OR_EXPIRED_SIGNED_PASSPORT' };
  if (tool === 'verify_software' || tool === 'get_passport' || tool === 'get_trust_evidence' || tool === 'get_security_status' || tool === 'get_compliance_status' || tool === 'check_freshness') return passport;
  if (tool === 'verify_claim') {
    return { status: 'UNVERIFIED', claimHash: hashAgentClaim(args.claim), passportStatus: (passport as any).status, reason: 'SPR does not infer a claim from incomplete evidence; an explicit supporting observation is required.' };
  }
  return { status: 'UNKNOWN', reason: 'UNSUPPORTED_TOOL' };
}
