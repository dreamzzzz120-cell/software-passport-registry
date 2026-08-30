/**
 * Normalizes SBOM component names before they reach finding identity,
 * persisted evidence, or any API response.
 *
 * Syft names most components after the real package ("actions/checkout"),
 * but for file-shaped components it emits the ABSOLUTE path it scanned,
 * e.g.
 *   /tmp/spr-sec-job_<jobId>-<rand>/extracted/<repo>-<sha>/.github/workflows/main.yml
 *
 * Passing that through verbatim caused two real defects:
 *
 *  1. Information disclosure - the server's temp directory layout, the
 *     per-run job id and the extraction path were exposed to end users
 *     (including anonymous Free Review visitors) through finding
 *     `component`/`description`, the persisted SBOM and reports.
 *
 *  2. Broken finding dedup - `component` is part of the finding identity
 *     (src/security/scan-finding-identity.ts). Because the prefix embeds a
 *     per-run job id and random temp suffix, the SAME underlying finding
 *     hashed differently on every rescan and accumulated duplicate rows.
 *     That silently defeated the job-id removal already done in
 *     scan-finding-identity.ts, by smuggling the job id back in through
 *     the component field.
 *
 * The normalized value is the repository-relative path, which is stable
 * across rescans and across commits (the scan root includes the commit-
 * SHA'd archive directory, so relativizing against it removes that too).
 *
 * Deliberately platform-independent: it compares normalized POSIX strings
 * instead of using path.relative(), so the same component always produces
 * the same identity regardless of which OS the worker runs on.
 */

/** True for values that look like an absolute filesystem path rather than a package name. */
function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value);
}

function toPosix(value: string): string {
  return value.replaceAll('\\', '/');
}

/**
 * Returns a safe, deterministic component name.
 *
 * - Package-style names ("actions/checkout", "lodash") pass through unchanged.
 * - Absolute paths under `scanRoot` become repository-relative.
 * - Absolute paths that cannot be relativized fall back to the bare file
 *   name, so a raw server path is never returned even when `scanRoot` is
 *   missing, mismatched, or the value escapes the root.
 *
 * Idempotent: normalizing an already-normalized value returns it unchanged.
 */
export function normalizeComponentName(rawName: unknown, scanRoot?: string | null): string {
  const name = String(rawName ?? '').trim();
  if (!name) return 'unknown';
  if (!isAbsolutePathLike(name)) return name;

  const posixName = toPosix(name);
  const posixRoot = toPosix(String(scanRoot ?? '').trim()).replace(/\/+$/, '');

  if (posixRoot && (posixName === posixRoot || posixName.startsWith(`${posixRoot}/`))) {
    const relative = posixName.slice(posixRoot.length).replace(/^\/+/, '');
    if (relative) return relative;
  }

  // Absolute path we cannot safely relativize. Never return it as-is: the
  // bare file name carries the useful signal without the server's layout.
  const base = posixName.split('/').filter(Boolean).pop();
  return base || 'unknown';
}

/**
 * Applies normalizeComponentName to every component in a CycloneDX
 * document, returning a new document. The caller keeps the untouched raw
 * Syft bytes for the SBOM evidence hash, so evidence integrity is
 * unaffected - only the values that flow onward to findings, the persisted
 * SBOM and API responses are normalized.
 *
 * A component's `purl` is carried into the persisted SBOM too (and is
 * therefore user-visible), so a path-shaped purl is dropped. A legitimate
 * package URL ("pkg:npm/lodash@1.0.0") never contains a filesystem path,
 * so this cannot affect real ecosystem detection.
 *
 * Missing/empty/non-string names are left exactly as they are so the
 * existing SBOM_INVALID validation in normalizeCycloneDx() still rejects a
 * malformed document rather than silently accepting it as "unknown".
 */
export function normalizeCycloneDxComponentNames(document: any, scanRoot?: string | null): any {
  if (!document || !Array.isArray(document.components)) return document;
  return {
    ...document,
    components: document.components.map((component: any) => {
      if (!component || typeof component !== 'object') return component;
      const next = { ...component };
      if (typeof component.name === 'string' && component.name.trim().length > 0) {
        next.name = normalizeComponentName(component.name, scanRoot);
      }
      if (typeof component.purl === 'string' && isAbsolutePathLike(component.purl.trim())) {
        delete next.purl;
      }
      return next;
    }),
  };
}
