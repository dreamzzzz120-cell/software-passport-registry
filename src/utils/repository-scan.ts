export const REPOSITORY_SCANNER_CONFIGURATION = 'syft:1.49.0:cyclonedx-json+osv:v1';

type ExistingSource = {
  requestedRef: string | null;
  resolvedCommitSha: string | null;
  scannerConfiguration: string;
  jobId: string;
};

export function findDuplicateActiveRepositoryScan(
  sources: ExistingSource[],
  activeJobIds: Set<string>,
  requestedRef: string | undefined,
  scannerConfiguration = REPOSITORY_SCANNER_CONFIGURATION,
) {
  const requested = requestedRef || '';
  const exactSha = /^[a-f0-9]{40}$/i.test(requested) ? requested.toLowerCase() : null;
  return sources.find(source => {
    if (!activeJobIds.has(source.jobId)) return false;
    if (source.scannerConfiguration !== scannerConfiguration) return false;
    if ((source.requestedRef || '') === requested) return true;
    return exactSha !== null && source.resolvedCommitSha?.toLowerCase() === exactSha;
  });
}
