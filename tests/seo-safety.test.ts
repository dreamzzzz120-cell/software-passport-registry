import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const robots = read('public/robots.txt');
const sitemap = read('public/sitemap.xml');
const indexHtml = read('index.html');
const app = read('src/App.tsx');

// These files document WHY things are excluded, so the rationale comments
// legitimately mention /api/, AggregateRating and rel="canonical". Assert
// against real markup only, or the prose explaining an exclusion trips the
// very check that enforces it.
const stripComments = (source: string) => source.replace(/<!--[\s\S]*?-->/g, '');
const sitemapMarkup = stripComments(sitemap);
const indexMarkup = stripComments(indexHtml);

// The authoritative public route set, taken from App.tsx rather than
// assumed. /login is public but deliberately not indexed.
// /passport/demo was added deliberately as a reviewed public route: a static,
// read-only sample Passport that touches no database and no tenant. The
// guarantee this list protects is unchanged - every entry must be genuinely
// public, and no authenticated route may ever appear here.
const PUBLIC_INDEXABLE = ['/', '/free-review', '/passport/demo', '/pricing', '/msp', '/terms', '/privacy'];

// The canonical origin is www (see the seo commits that moved sitemap, robots
// and JSON-LD onto it together). It is read from the shipped robots.txt rather
// than restated here: a second hardcoded copy is exactly what let the sitemap
// and this test disagree about the host while both looked self-consistent.
const CANONICAL_ORIGIN = (() => {
  const match = robots.match(/^Sitemap: (https:\/\/[^/]+)\/sitemap\.xml$/m);
  if (!match) throw new Error('robots.txt declares no Sitemap line to take the canonical origin from');
  return match[1];
})();

// Authenticated views rendering tenant-scoped customer data. /registry is
// included on purpose: despite the name it is an alias of the authenticated
// /passports view, NOT a public registry.
const AUTHENTICATED_ROUTES = [
  '/dashboard', '/registry', '/passports', '/clients', '/evidence-explorer',
  '/reports', '/monitoring', '/settings', '/team', '/billing', '/audit-log',
  '/trust-graph', '/vendors', '/governance', '/security', '/compliance',
];

describe('sitemap contains only genuinely public URLs', () => {
  it('lists every public route', () => {
    for (const route of PUBLIC_INDEXABLE) {
      const url = route === '/' ? `${CANONICAL_ORIGIN}/` : `${CANONICAL_ORIGIN}${route}`;
      expect(sitemap).toContain(`<loc>${url}</loc>`);
    }
  });

  it('never lists an authenticated route', () => {
    for (const route of AUTHENTICATED_ROUTES) {
      expect(sitemap).not.toContain(`<loc>${CANONICAL_ORIGIN}${route}</loc>`);
    }
  });

  it('never lists a Passport, share token, or API path', () => {
    expect(sitemapMarkup).not.toMatch(/\/api\//);
    expect(sitemapMarkup).not.toMatch(/passport_/);
    expect(sitemapMarkup).not.toMatch(/\/trust\//);
    expect(sitemapMarkup).not.toMatch(/token/i);
  });

  it('contains no duplicate URLs', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBe(new Set(locs).size);
    expect(locs.length).toBe(PUBLIC_INDEXABLE.length);
  });

  it('declares no fabricated lastmod dates', () => {
    expect(sitemap).not.toContain('<lastmod>');
  });

  it('is well-formed XML with a single urlset', () => {
    expect(sitemap.trimStart().startsWith('<?xml')).toBe(true);
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect((sitemap.match(/<url>/g) || []).length).toBe((sitemap.match(/<\/url>/g) || []).length);
  });
});

describe('robots policy protects the authenticated application', () => {
  it('disallows every authenticated route, including the misleadingly named /registry', () => {
    for (const route of AUTHENTICATED_ROUTES) {
      expect(robots).toContain(`Disallow: ${route}`);
    }
  });

  it('disallows the API, which includes signed public share links', () => {
    expect(robots).toContain('Disallow: /api/');
  });

  it('allows the public marketing surfaces', () => {
    for (const route of ['/free-review', '/pricing', '/msp', '/terms', '/privacy']) {
      expect(robots).toContain(`Allow: ${route}`);
    }
  });

  it('points at the sitemap', () => {
    expect(robots).toContain(`Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`);
    // Every indexed URL must sit on that same origin -- a sitemap that mixes
    // apex and www hosts splits the site's ranking across two origins.
    for (const loc of [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])) {
      expect(loc.startsWith(`${CANONICAL_ORIGIN}/`)).toBe(true);
    }
  });

  it('states that it is not a security boundary', () => {
    // Guards against a future edit that treats robots.txt as access control.
    expect(robots).toMatch(/NOT a security boundary/i);
  });
});

describe('the public route set matches the application itself', () => {
  it('every route the sitemap indexes is actually public in App.tsx', () => {
    const declared = app.match(/const PUBLIC_PATHS = new Set\(\[([^\]]+)\]\)/);
    expect(declared).not.toBeNull();
    const publicPaths = [...declared![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const route of PUBLIC_INDEXABLE) {
      expect(publicPaths).toContain(route);
    }
  });

  it('/registry is an authenticated view, not a public one', () => {
    const declared = app.match(/const PUBLIC_PATHS = new Set\(\[([^\]]+)\]\)/);
    const publicPaths = [...declared![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(publicPaths).not.toContain('/registry');
    expect(app).toContain("case '/passports': case '/registry':");
  });
});

describe('structured data and social metadata are honest', () => {
  it('the JSON-LD block is valid JSON', () => {
    const match = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    expect(() => JSON.parse(match![1])).not.toThrow();
  });

  it('declares only Organization and WebSite', () => {
    const match = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const parsed = JSON.parse(match![1]);
    const types = parsed['@graph'].map((node: { '@type': string }) => node['@type']);
    expect(types.sort()).toEqual(['Organization', 'WebSite']);
  });

  it('fabricates no ratings, reviews, prices or certifications', () => {
    for (const forbidden of ['AggregateRating', 'aggregateRating', 'Review', 'ratingValue', 'reviewCount', 'Offer', 'priceCurrency', 'certification']) {
      expect(indexMarkup).not.toContain(forbidden);
    }
  });

  it('makes no unqualified safety claim in social metadata', () => {
    const meta = [...indexMarkup.matchAll(/content="([^"]*)"/g)].map((m) => m[1]).join(' ').toLowerCase();
    for (const claim of ['guaranteed', 'vulnerability-free', 'fully secure', 'certified secure', '100% safe']) {
      expect(meta).not.toContain(claim);
    }
  });

  it('declares no static canonical, which would collapse every route onto the homepage', () => {
    expect(indexMarkup).not.toContain('rel="canonical"');
  });
});
