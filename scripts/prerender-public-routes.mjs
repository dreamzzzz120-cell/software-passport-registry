/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Emits a real static HTML page for each public route, so that every public
 * surface has its own title, description, canonical URL and social preview.
 *
 * Why this exists: the app is a client-rendered Vite SPA that serves one
 * index.html shell for every route. Search engines can execute JavaScript, but
 * social and link-preview crawlers (Slack, LinkedIn, X, iMessage) read the
 * served HTML only -- so a title set from React is invisible to them, and a
 * single static canonical in the shell would collapse /pricing and /msp onto
 * the homepage. Generating one shell per route fixes both without introducing
 * a server-rendering framework, a second frontend, or any change to client
 * routing: every generated file boots the same bundle and only the <head>
 * differs.
 *
 * Vercel resolves static files before the SPA catch-all rewrite in
 * vercel.json, so dist/pricing/index.html is what /pricing actually serves.
 *
 * Plain ESM on purpose: this runs inside `npm run build` on both Vercel and in
 * the Docker builder, and must not depend on a TypeScript loader.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadPageDefinitions(source = path.join(root, 'src/seo/public-pages.json')) {
  const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
  return { origin: parsed.origin, pages: parsed.pages };
}

const escapeAttribute = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

/**
 * Replaces exactly one occurrence, and throws when the pattern is missing or
 * ambiguous. A silent miss would publish a page carrying the generic homepage
 * title, which is the exact defect this script exists to remove, so a drifted
 * shell must break the build rather than ship.
 */
function replaceExactlyOnce(html, pattern, replacement, label) {
  const matches = html.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`));
  if (!matches || matches.length !== 1) {
    throw new Error(`[prerender] expected exactly one ${label} in the built shell, found ${matches ? matches.length : 0}. index.html changed shape -- update scripts/prerender-public-routes.mjs.`);
  }
  return html.replace(pattern, () => replacement);
}

export function canonicalUrl(origin, routePath) {
  return routePath === '/' ? `${origin}/` : `${origin}${routePath}`;
}

const LD_JSON_PATTERN = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/;

/**
 * Adds a WebPage node describing this specific route to the existing
 * Organization + WebSite graph. It restates only what the page already says
 * about itself -- name, description, URL, and which WebSite it belongs to.
 * Nothing is asserted that the page does not contain: no ratings, offers,
 * awards, certifications or compliance claims.
 */
function withWebPageNode(html, page, url) {
  const match = html.match(LD_JSON_PATTERN);
  if (!match) throw new Error('[prerender] the built shell has no JSON-LD block to extend.');

  const graph = JSON.parse(match[1]);
  const website = graph['@graph'].find((node) => node['@type'] === 'WebSite');
  if (!website) throw new Error('[prerender] the JSON-LD graph has no WebSite node to attach the page to.');

  graph['@graph'] = [
    ...graph['@graph'],
    {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: page.title,
      description: page.description,
      isPartOf: { '@id': website['@id'] },
    },
  ];

  const serialized = JSON.stringify(graph, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `      ${line}`))
    .join('\n');
  return html.replace(LD_JSON_PATTERN, () => `<script type="application/ld+json">\n      ${serialized}\n    </script>`);
}

export function applyPageMetadata(shell, page, origin) {
  const url = canonicalUrl(origin, page.path);
  const title = escapeAttribute(page.title);
  const description = escapeAttribute(page.description);

  let html = shell;
  html = replaceExactlyOnce(html, /<title>[\s\S]*?<\/title>/, `<title>${title}</title>`, '<title>');
  html = replaceExactlyOnce(html, /<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${description}" />`, 'meta description');
  html = replaceExactlyOnce(html, /<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${title}" />`, 'og:title');
  html = replaceExactlyOnce(html, /<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${description}" />`, 'og:description');
  html = replaceExactlyOnce(html, /<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${url}" />`, 'og:url');
  html = replaceExactlyOnce(html, /<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${title}" />`, 'twitter:title');
  html = replaceExactlyOnce(html, /<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${description}" />`, 'twitter:description');
  html = replaceExactlyOnce(html, /<meta name="twitter:url" content="[^"]*"\s*\/?>/, `<meta name="twitter:url" content="${url}" />`, 'twitter:url');

  if (/rel="canonical"/.test(html)) {
    throw new Error('[prerender] the shell already declares a canonical link; a static canonical would point every route at one URL.');
  }
  html = withWebPageNode(html, page, url);
  return replaceExactlyOnce(html, /<\/head>/, `  <link rel="canonical" href="${url}" />\n  </head>`, '</head>');
}

export function outputFileFor(distDir, routePath) {
  return routePath === '/'
    ? path.join(distDir, 'index.html')
    : path.join(distDir, routePath.replace(/^\//, ''), 'index.html');
}

function main() {
  const distDir = path.join(root, 'dist');
  const shellPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(shellPath)) {
    throw new Error(`[prerender] ${shellPath} does not exist. Run vite build first.`);
  }

  const shell = fs.readFileSync(shellPath, 'utf8');
  const { origin, pages } = loadPageDefinitions();

  for (const page of pages) {
    const destination = outputFileFor(distDir, page.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, applyPageMetadata(shell, page, origin), 'utf8');
    console.log(`[prerender] ${page.path} -> ${path.relative(root, destination)}`);
  }
  console.log(`[prerender] wrote ${pages.length} public pages with per-route metadata`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
