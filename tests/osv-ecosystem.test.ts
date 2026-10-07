import { describe, expect, it } from 'vitest';
import { osvEcosystemFromPurl, osvEcosystemFromComponent } from '../src/security/osv-ecosystem.ts';
describe('universal OSV ecosystem mapping', () => {
  const cases: Array<[string,string]> = [['pkg:npm/react@18.3.1','npm'],['pkg:pypi/requests@2.32.3','PyPI'],['pkg:golang/github.com/foo/bar@v1.2.3','Go'],['pkg:cargo/serde@1.0.0','crates.io'],['pkg:maven/org.example/app@1.0.0','Maven'],['pkg:nuget/Newtonsoft.Json@13.0.3','NuGet'],['pkg:gem/rails@7.2.1','RubyGems'],['pkg:composer/laravel/framework@11.0.0','Packagist'],['pkg:hex/phoenix@1.7.0','Hex'],['pkg:pub/flutter@3.0.0','Pub']];
  it.each(cases)('maps %s to %s',(purl,ecosystem)=>expect(osvEcosystemFromPurl(purl)).toBe(ecosystem));
  it('prefers explicit ecosystem when PURL is absent',()=>expect(osvEcosystemFromComponent({ecosystem:'Maven'})).toBe('Maven'));
  it('does not guess unknown ecosystems',()=>expect(osvEcosystemFromPurl('pkg:generic/acme/tool@1.0.0')).toBeUndefined());
});
