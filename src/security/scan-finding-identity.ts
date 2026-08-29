/**
 * Stable identity for secret/IaC-config/license findings produced by the
 * repository security scanner. Deliberately excludes the per-run job id -
 * mirrors osv-identity.ts, which already gets this right for OSV/CVE
 * findings. Including the job id here caused every rescan to mint a new
 * finding row for the same logical issue instead of deduplicating.
 */
export function scanFindingIdentity(input: {
  tenantId: string;
  passportId: string;
  engineId: string;
  category: string;
  title: string;
  component?: string | null;
}) {
  return `${input.tenantId}|${input.passportId}|${input.engineId}|${input.category}|${input.title}|${input.component || ''}`;
}
