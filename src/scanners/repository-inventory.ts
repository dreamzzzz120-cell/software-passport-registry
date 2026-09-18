/**
 * Builds the file inventory for an acquired GitHub archive. Shared by the
 * repository (SBOM/OSV) worker and the security (content) worker so both halves
 * of one scan enumerate the same listing the same way and merge into one
 * ledger. The archive listing is the discovery source; the extracted tree is
 * where each entry is observed (size, hash, symlink, presence); nested
 * archives are listed one level deep and recorded, never extracted.
 */
import path from 'node:path';
import {
  applyCatalogLocations, applyContentInspection, applyManifestInventory, enumerateNestedArchives, entriesFromListing,
  finalizeDispositions, markOutsideScope, observeExtractedEntries, toPosix, type ArchiveLister, type ContentInspectionReport, type InventoryEntry, type InventoryTool,
} from './file-inventory.ts';
import { contentUnsupportedReason } from './real-repository-scanners.ts';

export const INVENTORY_TOOL: InventoryTool = { name: 'spr-file-inventory', version: '1', action: 'inventory' };
export const ARCHIVE_LISTING_TOOL: InventoryTool = { name: 'spr-archive-lister', version: '1', action: 'listing' };
export const MANIFEST_TOOL: InventoryTool = { name: 'repository-worker', version: '1', action: 'manifest-inventory' };
export const SYFT_TOOL = (version: string): InventoryTool => ({ name: 'syft', version, action: 'catalog' });

type Runner = (executable: string, args: string[], timeoutMs: number, outputLimit?: number) => Promise<{ code: number; stdout: Buffer; stderr: string }>;

/** Lists a zip or tar archive with the platform's archive tool; never extracts. */
export function makeArchiveLister(runBounded: Runner): ArchiveLister {
  return async (absolutePath, filename) => {
    const lower = filename.toLowerCase();
    const isZip = /\.(zip|jar|war|ear|whl|nupkg|vsix)$/.test(lower);
    const isTar = /\.(tar|tgz|tar\.gz|tar\.bz2|tbz2|tar\.xz|txz)$/.test(lower);
    if (!isZip && !isTar) return { ok: false, reasonCode: 'ARCHIVE_FORMAT_NOT_ENUMERABLE', reasonDetail: 'SPR lists zip and tar archives only; this archive format was not opened.' };
    try {
      const args = process.platform === 'win32' ? ['-tf', absolutePath] : isZip ? ['-Z1', absolutePath] : ['-tf', absolutePath];
      const executable = process.platform === 'win32' ? 'tar.exe' : isZip ? 'unzip' : 'tar';
      let result = await runBounded(executable, args, 30_000, 10 * 1024 * 1024);
      // Developer machines only: an MSYS GNU tar reads "C:..." as a remote
      // host unless told otherwise; the production image is Linux.
      if (result.code !== 0 && process.platform === 'win32') result = await runBounded(executable, ['--force-local', ...args], 30_000, 10 * 1024 * 1024);
      if (result.code !== 0) return { ok: false, reasonCode: 'ARCHIVE_UNREADABLE', reasonDetail: `The archive tool exited with code ${result.code}; the archive could not be listed.` };
      return { ok: true, entries: result.stdout.toString('utf8').split(/\r?\n/).filter(Boolean) };
    } catch (error) {
      return { ok: false, reasonCode: 'ARCHIVE_UNREADABLE', reasonDetail: error instanceof Error ? error.message.slice(0, 200) : 'listing failed' };
    }
  };
}

export interface RepositoryInventoryInput {
  /** Raw archive listing (every entry, as the archive tool printed it). */
  listing: string[];
  /** Directory the archive was extracted into (the single top-level folder inside it). */
  repositoryRoot: string;
  /** Requested subdirectory inside the repository, '' for the whole tree. */
  subdirectory: string;
  archiveLister: ArchiveLister;
}

export interface RepositoryInventory {
  entries: InventoryEntry[];
  truncated: boolean;
  limitations: string[];
  /** Scan-root-relative -> repository-relative prefix ('' when the whole tree is scanned). */
  scopePrefix: string;
}

/** Discovery + observation. Engines add their outcomes afterwards via the apply* helpers. */
export async function buildRepositoryInventory(input: RepositoryInventoryInput): Promise<RepositoryInventory> {
  const { entries, truncated } = entriesFromListing(input.listing, { source: 'github-archive', stripSegments: 1 });
  const limitations: string[] = [];
  await observeExtractedEntries(input.repositoryRoot, entries);
  const scopePrefix = toPosix(input.subdirectory).replace(/^\/+|\/+$/g, '');
  if (scopePrefix) markOutsideScope(entries, scopePrefix, INVENTORY_TOOL);
  const nested = await enumerateNestedArchives(entries, input.archiveLister, ARCHIVE_LISTING_TOOL);
  if (nested.truncated) limitations.push('NESTED_ARCHIVE_MEMBERS_TRUNCATED: at least one nested archive had more members than SPR records; its member list is a lower bound.');
  return { entries, truncated: truncated, limitations, scopePrefix };
}

/** Prefixes a scan-root-relative path with the requested subdirectory so it matches repository-relative inventory paths. */
export function scopedPath(scopePrefix: string, relative: string): string {
  const posix = toPosix(relative).replace(/^\/+/, '');
  return scopePrefix ? `${scopePrefix}/${posix}` : posix;
}

export function applyRepositoryEngineOutcomes(inventory: RepositoryInventory, outcomes: { manifests?: string[]; manifestEvidenceId?: string | null; cycloneDx?: any; syftVersion?: string; sbomEvidenceId?: string | null }): void {
  if (outcomes.manifests) applyManifestInventory(inventory.entries, outcomes.manifests.map((m) => scopedPath(inventory.scopePrefix, m)), outcomes.manifestEvidenceId ?? null, MANIFEST_TOOL);
  if (outcomes.cycloneDx) {
    applyCatalogLocations(inventory.entries, outcomes.cycloneDx, SYFT_TOOL(outcomes.syftVersion ?? 'unknown'), inventory.scopePrefix);
    if (outcomes.sbomEvidenceId) for (const entry of inventory.entries) if (entry.analysisStatus === 'analyzed' && !entry.relatedEvidenceIds.includes(outcomes.sbomEvidenceId)) entry.relatedEvidenceIds.push(outcomes.sbomEvidenceId);
  }
  finalizeDispositions(inventory.entries, { contentUnsupportedReason: (entry) => entry.source === 'nested-archive' ? null : contentUnsupportedReason(entry.path), contentInspectionRan: false });
}

export function applySecurityEngineOutcomes(inventory: RepositoryInventory, outcomes: { inspectionReports: ContentInspectionReport[]; cycloneDx?: any; syftVersion?: string; findings: Array<{ id: string; filePath: string | null }>; evidenceId?: string | null }): void {
  applyContentInspection(inventory.entries, outcomes.inspectionReports.map((report) => ({ ...report, path: scopedPath(inventory.scopePrefix, report.path) })));
  if (outcomes.cycloneDx) applyCatalogLocations(inventory.entries, outcomes.cycloneDx, SYFT_TOOL(outcomes.syftVersion ?? 'unknown'), inventory.scopePrefix);
  const byPath = new Map<string, InventoryEntry[]>();
  for (const entry of inventory.entries) { const list = byPath.get(entry.path) ?? []; list.push(entry); byPath.set(entry.path, list); }
  for (const finding of outcomes.findings) {
    if (!finding.filePath) continue;
    for (const entry of byPath.get(scopedPath(inventory.scopePrefix, finding.filePath)) ?? []) if (!entry.relatedFindingIds.includes(finding.id)) entry.relatedFindingIds.push(finding.id);
  }
  if (outcomes.evidenceId) for (const entry of inventory.entries) if (entry.inspectionStatus === 'inspected' && !entry.relatedEvidenceIds.includes(outcomes.evidenceId)) entry.relatedEvidenceIds.push(outcomes.evidenceId);
  finalizeDispositions(inventory.entries, { contentUnsupportedReason: (entry) => entry.source === 'nested-archive' ? null : contentUnsupportedReason(entry.path), contentInspectionRan: true });
}

export function relativeToRoot(root: string, absolute: string): string { return toPosix(path.relative(root, absolute)); }
