import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Plain ESM build script, deliberately untyped so it can run inside
// `npm run build` on Vercel and in the Docker builder with no TS loader.
import { applyPageMetadata, canonicalUrl, loadPageDefinitions, outputFileFor } from '../scripts/prerender-public-routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

interface PublicPage { path: string; title: string; description: string }

const { origin, pages } = loadPageDefinitions() as { origin: string; pages: PublicPage[] };
const shell = read('index.html');
const sitemap = read('public/sitemap.xml');
const robots = read('public/robots.txt');
const app = read('src/App.tsx');

const pageFor = (routePath: string): PublicPage => {
  const page = pages.find(item => item.path === routePath);
  expect(page, `src/seo/public-pages.json must define ${routePath}`).toBeDefined();
  return page!;
};

const rendered = (routePath: string): string => applyPageMetadata(shell, pageFor(routePath), origin);

const attribute = (html: string, pattern: RegExp): string | null => html.match(pattern)?.[1] ?? null;

const titleOf = (html: string) => attribute(html, /<title>([\s\S]*?)<\/title>/);
const descriptionOf = (html: string) => attribute(html, /<meta name="description" content="([^"]*)"/);
const canonicalOf = (html: string) => attribute(html, /<link rel="canonical" href="([^"]*)"/);
const ogTitleOf = (html: string) => attribute(html, /<meta property="og:title" content="([^"]*)"/);
const ogDescriptionOf = (html: string) => attribute(html, /<meta property="og:description" content="([^"]*)"/);
const ogUrlOf = (html: string) => attribute(html, /<meta property="og:url" content="([^"]*)"/);
const twitterUrlOf = (html: string) => attribute(html, /<meta name="twitter:url" content="([^"]*)"/);

// The routes the production defect was reported against. Every one of these
// served a byte-identical <head> before prerendering existed.
const REQUIRED_ROUTES = ['/', '/pricing', '/msp', '/free-review'];

// Never indexable, never prerendered: authenticated views over tenant-scoped
// customer data, plus the API.
const PRIVATE_ROUTES = [
  '/dashboard', '/registry', '/passports', '/clients', '/evidence-explorer', '/reports',
  '/monitoring', '/settings', '/team', '/billing', '/audit-log', '/trust-graph', '/vendors',
  '/governance', '/security', '/compliance', '/scans', '/alerts', '/integrations', '/login',
];

describe('every required public route gets its own metadata', () => {
  it.each(REQUIRED_ROUTES)('%s produces a unique title, description, canonical and Open Graph set', routePath => {
    const html = rendered(routePath);
    const page = pageFor(routePath);
    const expectedUrl = routePath === '/' ? `${origin}/` : `${origin}${routePath}`;

    // Titles and descriptions carry an em dash and an ampersand, so compare
    // against the HTML-escaped form the page actually serves.
    const escaped = (value: string) => value.replaceAll('&', '&amp;');

    expect(titleOf(html)).toBe(escaped(page.title));
    expect(descriptionOf(html)).toBe(escaped(page.description));
    expect(canonicalOf(html)).toBe(expectedUrl);
    expect(ogTitleOf(html)).toBe(escaped(page.title));
    expect(ogDescriptionOf(html)).toBe(escaped(page.description));
    expect(ogUrlOf(html)).toBe(expectedUrl);
    expect(twitterUrlOf(html)).toBe(expectedUrl);
  });

  it('uses the exact titles the production SEO specification requires', () => {
    expect(pageFor('/').title).toBe('Software Passport Registry — Verify Software Before You Buy');
    expect(pageFor('/pricing').title).toBe('Software Passport Registry Pricing — Software Verification');
    expect(pageFor('/msp').title).toBe('Software Passport Registry for MSPs — Software Trust & Risk Visibility');
    expect(pageFor('/free-review').title).toBe('Free Software Review — Software Passport Registry');
  });

  it('REGRESSION: no two public routes share a title, description or canonical', () => {
    const titles = pages.map(page => page.title);
    const descriptions = pages.map(page => page.description);
    const canonicals = pages.map(page => canonicalUrl(origin, page.path));
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(new Set(canonicals).size).toBe(canonicals.length);
  });

  it('REGRESSION: no route keeps the generic shell title or shell description', () => {
    const shellTitle = titleOf(shell);
    const shellDescription = descriptionOf(shell);
    for (const page of pages) {
      const html = applyPageMetadata(shell, page, origin);
      expect(titleOf(html), `${page.path} still serves the shell title`).not.toBe(shellTitle);
      expect(descriptionOf(html), `${page.path} still serves the shell description`).not.toBe(shellDescription);
    }
  });

  it('never canonicalises a sub-page onto the homepage', () => {
    for (const page of pages.filter(item => item.path !== '/')) {
      expect(canonicalOf(applyPageMetadata(shell, page, origin))).not.toBe(`${origin}/`);
    }
  });

  it('canonicalises to the www production domain', () => {
    expect(origin).toBe('https://www.softwarepassportregistry.com');
    for (const page of pages) {
      expect(canonicalUrl(origin, page.path)).toContain('https://www.softwarepassportregistry.com');
      expect(canonicalUrl(origin, page.path)).not.toContain('https://softwarepassportregistry.com/');
    }
  });
});

describe('generated metadata is well-formed and honest', () => {
  it('keeps titles and descriptions within the lengths search engines display', () => {
    for (const page of pages) {
      expect(page.title.length, `${page.path} title`).toBeGreaterThanOrEqual(15);
      expect(page.title.length, `${page.path} title`).toBeLessThanOrEqual(70);
      expect(page.description.length, `${page.path} description`).toBeGreaterThanOrEqual(70);
      expect(page.description.length, `${page.path} description`).toBeLessThanOrEqual(160);
    }
  });

  it('fabricates no rating, review, price, award, certification or compliance claim', () => {
    const copy = pages.map(page => `${page.title} ${page.description}`).join(' ').toLowerCase();
    for (const forbidden of [
      'guaranteed', 'vulnerability-free', 'fully secure', 'certified secure', '100% safe',
      'soc 2', 'soc2', 'iso 27001', 'government approved', 'officially endorsed',
      'award-winning', 'best-rated', '5-star', 'certified', 'accredited',
    ]) {
      expect(copy, `metadata must not claim "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('adds only a WebPage node to the existing Organization + WebSite graph', () => {
    const html = rendered('/pricing');
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(block).not.toBeNull();
    const graph = JSON.parse(block![1]);
    const types = graph['@graph'].map((node: { '@type': string }) => node['@type']).sort();
    expect(types).toEqual(['Organization', 'WebPage', 'WebSite']);

    const webPage = graph['@graph'].find((node: { '@type': string }) => node['@type'] === 'WebPage');
    expect(webPage.url).toBe(`${origin}/pricing`);
    expect(webPage.name).toBe(pageFor('/pricing').title);
    expect(webPage.isPartOf['@id']).toBe(`${origin}/#website`);
    for (const forbidden of ['aggregateRating', 'ratingValue', 'reviewCount', 'Offer', 'priceCurrency']) {
      expect(JSON.stringify(graph)).not.toContain(forbidden);
    }
  });

  it('keeps the real social image, and never a fabricated asset URL', () => {
    const html = rendered('/msp');
    expect(html).toContain('<meta property="og:image" content="https://softwarepassportregistry.com/brand/spr-logo.jpg" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(fs.existsSync(path.join(root, 'public/brand/spr-logo.jpg'))).toBe(true);
  });

  it('preserves the site-level og:type and og:site_name on every page', () => {
    for (const page of pages) {
      const html = applyPageMetadata(shell, page, origin);
      expect(html).toContain('<meta property="og:type" content="website" />');
      expect(html).toContain('<meta property="og:site_name" content="Software Passport Registry" />');
    }
  });

  it('escapes markup-significant characters rather than emitting raw HTML', () => {
    const html = rendered('/msp');
    expect(titleOf(html)).toContain('&amp;');
    expect(titleOf(html)).not.toMatch(/[<>]/);
  });
});

describe('the prerender fails loudly instead of shipping wrong metadata', () => {
  it('throws when a substitution target is missing from the shell', () => {
    const withoutDescription = shell.replace(/<meta name="description" content="[^"]*"\s*\/?>/, '');
    expect(() => applyPageMetadata(withoutDescription, pageFor('/pricing'), origin)).toThrow(/meta description/);
  });

  it('throws when the shell already carries a static canonical', () => {
    const withCanonical = shell.replace('</head>', '<link rel="canonical" href="https://softwarepassportregistry.com/" />\n</head>');
    expect(() => applyPageMetadata(withCanonical, pageFor('/msp'), origin)).toThrow(/canonical/);
  });

  it('throws when a substitution target is duplicated, which would make the result ambiguous', () => {
    const duplicated = shell.replace('<title>', '<title>Software Passport Registry</title>\n    <title>');
    expect(() => applyPageMetadata(duplicated, pageFor('/'), origin)).toThrow(/<title>/);
  });

  it('is wired into the production build, after vite and before the server bundle', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(packageJson.scripts.build).toContain('node scripts/prerender-public-routes.mjs');
    expect(packageJson.scripts.build.indexOf('vite build')).toBeLessThan(packageJson.scripts.build.indexOf('prerender-public-routes'));
  });

  it('writes each route to the path Vercel resolves before the SPA catch-all rewrite', () => {
    expect(outputFileFor('/dist', '/')).toBe(path.join('/dist', 'index.html'));
    expect(outputFileFor('/dist', '/pricing')).toBe(path.join('/dist', 'pricing', 'index.html'));
    expect(outputFileFor('/dist', '/passport/demo')).toBe(path.join('/dist', 'passport', 'demo', 'index.html'));

    const vercel = JSON.parse(read('vercel.json')) as { rewrites: Array<{ source: string; destination: string }> };
    const catchAll = vercel.rewrites.at(-1);
    expect(catchAll).toMatchObject({ source: '/(.*)', destination: '/index.html' });
  });
});

describe('private application routes are never made indexable', () => {
  it('no authenticated route is prerendered', () => {
    const prerendered = pages.map(page => page.path);
    for (const route of PRIVATE_ROUTES) {
      expect(prerendered, `${route} must not have a public SEO page`).not.toContain(route);
    }
  });

  it('every prerendered route is genuinely public in App.tsx', () => {
    const declared = app.match(/const PUBLIC_PATHS = new Set\(\[([^\]]+)\]\)/);
    expect(declared).not.toBeNull();
    const publicPaths = [...declared![1].matchAll(/'([^']+)'/g)].map(match => match[1]);
    for (const page of pages) {
      expect(publicPaths, `${page.path} is prerendered but not public`).toContain(page.path);
    }
  });

  it('no metadata leaks an API path, share token or tenant identifier', () => {
    const copy = pages.map(page => `${page.path} ${page.title} ${page.description}`).join(' ');
    expect(copy).not.toMatch(/\/api\//);
    expect(copy).not.toMatch(/passport_/);
    expect(copy).not.toMatch(/token/i);
    expect(copy).not.toMatch(/tenant-/);
  });

  it('the prerendered set is exactly the sitemap, in both directions', () => {
    const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]).sort();
    const pageUrls = pages.map(page => canonicalUrl(origin, page.path)).sort();
    expect(pageUrls).toEqual(sitemapUrls);
  });

  it('robots.txt still allows the required public routes and disallows the application', () => {
    for (const route of ['/free-review', '/pricing', '/msp']) {
      expect(robots).toContain(`Allow: ${route}`);
    }
    for (const route of ['/dashboard', '/billing', '/settings', '/registry']) {
      expect(robots).toContain(`Disallow: ${route}`);
    }
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Sitemap: https://www.softwarepassportregistry.com/sitemap.xml');
  });
});
