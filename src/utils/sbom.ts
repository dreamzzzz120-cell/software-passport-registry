/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';

export interface SbomComponent {
  name: string;
  version: string;
  license: string;
  purl: string;
  depth: number;
  dependencyType: 'Direct' | 'Transitive';
  trustLevel: 'Trusted' | 'Review Required' | 'Blocked';
  integrity?: string;
  resolved?: string;
}

export interface CycloneDxSbom {
  $schema: string;
  bomFormat: string;
  specVersion: string;
  serialNumber: string;
  version: number;
  metadata: {
    timestamp: string;
    tools: Array<{ vendor: string; name: string; version: string }>;
    component: {
      type: string;
      name: string;
      version: string;
      licenses?: Array<{ license: { id?: string; name?: string } }>;
    };
  };
  components: Array<{
    type: string;
    name: string;
    version: string;
    licenses?: Array<{ license: { id?: string; name?: string } }>;
    purl: string;
    hashes?: Array<{ alg: string; content: string }>;
  }>;
}

/**
 * Generates a real Software Bill of Materials (SBOM) by inspecting `package.json`,
 * `package-lock.json`, and installed package metadata inside `node_modules`.
 */
export function generateRealSbom(workspacePath = '.'): {
  components: SbomComponent[];
  cycloneDx: CycloneDxSbom;
} {
  const rootPkgPath = path.resolve(workspacePath, 'package.json');
  const lockfilePath = path.resolve(workspacePath, 'package-lock.json');

  let directDeps = new Set<string>();
  let rootPkgName = 'software-passport-registry';
  let rootPkgVersion = '1.0.0';
  let rootLicense = 'MIT';

  if (fs.existsSync(rootPkgPath)) {
    try {
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
      rootPkgName = rootPkg.name || rootPkgName;
      rootPkgVersion = rootPkg.version || rootPkgVersion;
      rootLicense = rootPkg.license || rootLicense;

      const deps = Object.keys(rootPkg.dependencies || {});
      const devDeps = Object.keys(rootPkg.devDependencies || {});
      deps.forEach((d) => directDeps.add(d));
      devDeps.forEach((d) => directDeps.add(d));
    } catch (e) {
      console.warn('[Real SBOM Generator] Could not parse root package.json:', e);
    }
  }

  const components: SbomComponent[] = [];
  const cycloneComponents: CycloneDxSbom['components'] = [];

  if (fs.existsSync(lockfilePath)) {
    try {
      const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
      const packages = lockfile.packages || {};

      for (const [pkgPath, pkgData] of Object.entries<any>(packages)) {
        if (!pkgPath || pkgPath === '') continue; // Skip root package entry

        // Normalize package name from lockfile key (e.g., "node_modules/@google/genai" -> "@google/genai")
        const name = pkgPath.replace(/^node_modules\//, '').replace(/^.*node_modules\//, '');
        if (!name) continue;

        const version = pkgData.version || '0.0.0';
        const isDirect = directDeps.has(name) && !pkgPath.slice(13).includes('node_modules/');
        const dependencyType = isDirect ? 'Direct' : 'Transitive';
        const depth = isDirect ? 0 : 1;

        // Determine actual license from lockfile or node_modules/<pkgPath>/package.json
        let license = pkgData.license || '';
        if (!license) {
          const actualPkgJsonPath = path.resolve(workspacePath, pkgPath, 'package.json');
          if (fs.existsSync(actualPkgJsonPath)) {
            try {
              const actualPkg = JSON.parse(fs.readFileSync(actualPkgJsonPath, 'utf8'));
              if (typeof actualPkg.license === 'string') {
                license = actualPkg.license;
              } else if (typeof actualPkg.license === 'object' && actualPkg.license?.type) {
                license = actualPkg.license.type;
              } else if (Array.isArray(actualPkg.licenses) && actualPkg.licenses[0]?.type) {
                license = actualPkg.licenses[0].type;
              }
            } catch (err) {
              // Fallback
            }
          }
        }

        if (!license) {
          license = 'MIT'; // Fallback standard OSI license
        }

        const encodedName = name.includes('/') ? name.replace('@', '%40') : name;
        const purl = `pkg:npm/${encodedName}@${version}`;
        const integrity = pkgData.integrity || '';
        const resolved = pkgData.resolved || '';

        let trustLevel: 'Trusted' | 'Review Required' | 'Blocked' = 'Trusted';
        const licenseUpper = String(license).toUpperCase();
        if (licenseUpper.includes('GPL') || licenseUpper.includes('AGPL')) {
          trustLevel = 'Review Required';
        }

        components.push({
          name,
          version,
          license,
          purl,
          depth,
          dependencyType,
          trustLevel,
          integrity,
          resolved
        });

        const hashes: CycloneDxSbom['components'][0]['hashes'] = [];
        if (integrity.startsWith('sha512-')) {
          hashes.push({ alg: 'SHA-512', content: integrity.replace('sha512-', '') });
        } else if (integrity.startsWith('sha256-')) {
          hashes.push({ alg: 'SHA-256', content: integrity.replace('sha256-', '') });
        }

        cycloneComponents.push({
          type: 'library',
          name,
          version,
          licenses: [{ license: { id: license } }],
          purl,
          hashes
        });
      }
    } catch (e) {
      console.error('[Real SBOM Generator Error] Failed parsing package-lock.json:', e);
    }
  }

  const cycloneDx: CycloneDxSbom = {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${rootPkgName}-${Date.now()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'SPR', name: 'Real-Node-SBOM-Engine', version: '1.0.0' }],
      component: {
        type: 'application',
        name: rootPkgName,
        version: rootPkgVersion,
        licenses: [{ license: { id: rootLicense } }]
      }
    },
    components: cycloneComponents
  };

  return { components, cycloneDx };
}
