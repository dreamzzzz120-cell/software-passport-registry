/** Maps Package URLs to OSV ecosystem names without guessing. */
export function osvEcosystemFromPurl(purl?: string): string | undefined {
  if (typeof purl !== 'string' || !purl.trim()) return undefined;
  const type = purl.trim().toLowerCase().replace(/^pkg:/, '').split('/')[0];
  const map: Record<string,string> = {
    npm: 'npm', pypi: 'PyPI', golang: 'Go', cargo: 'crates.io', maven: 'Maven',
    nuget: 'NuGet', gem: 'RubyGems', composer: 'Packagist', hex: 'Hex', pub: 'Pub',
  };
  return map[type];
}

export function osvEcosystemFromComponent(component: { purl?: unknown; ecosystem?: unknown }): string | undefined {
  const fromPurl = osvEcosystemFromPurl(typeof component.purl === 'string' ? component.purl : undefined);
  if (fromPurl) return fromPurl;
  return typeof component.ecosystem === 'string' && component.ecosystem.trim() ? component.ecosystem.trim() : undefined;
}
