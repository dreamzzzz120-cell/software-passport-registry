/**
 * Include package.json declarations in the customer-visible CycloneDX document
 * without claiming an installed version or an OSV assessment.
 */
export function includeUnresolvedNpmDeclarations<T extends { components?: any[] }>(
  document: T,
  declared: Array<{ name: string; declaredRange: string }>,
): T & { components: any[] } {
  const existing = Array.isArray(document.components) ? document.components : [];
  const resolved = new Set(existing.filter((c) => typeof c?.purl === 'string' &&
    c.purl.startsWith('pkg:npm/') && typeof c.version === 'string' && c.version.length > 0)
    .map((c) => c.name));
  const additions = declared.filter((dep) => !resolved.has(dep.name)).map((dep) => ({
    type: 'library',
    name: dep.name,
    // Deliberately no version or purl: ranges are not installed versions.
    properties: [
      { name: 'spr:dependency:resolution', value: 'declared-unresolved' },
      { name: 'spr:dependency:declared-range', value: dep.declaredRange },
      { name: 'spr:dependency:source', value: 'package.json' },
    ],
  }));
  return { ...document, components: [...existing, ...additions] };
}
