/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live acceptance check for the public-repository team's GitHub Search
 * queries. Sends every default strategy with the languages GitHub is picky
 * about (C#, C++) plus one ordinary language through the exact URL builder
 * the worker uses, and reports the real HTTP status for each. Exits non-zero
 * if any request is not 200. Not a vitest suite on purpose: it needs the
 * network and GitHub's rate limit, so it is run explicitly, never skipped.
 *
 *   npx tsx scripts/verify-github-search-live.ts
 */
import { DEFAULT_QUERIES, buildGithubSearchQuery, githubSearchUrl } from '../src/agents/public-repository-team-v2.ts';

const STAR = String(Number.parseInt(process.env.REGISTRY_CRAWL_STAR_FLOOR ?? '50', 10) || 50);
const LANGS = ['C#', 'C++', 'JavaScript'];
const token = process.env.GITHUB_TOKEN?.trim() ?? '';
// Unauthenticated search allows 10 requests/minute; space them out.
const PAUSE_MS = token ? 1200 : 6500;

let failures = 0;
for (const [i, strategy] of DEFAULT_QUERIES.entries()) {
  for (const language of LANGS) {
    const url = githubSearchUrl(buildGithubSearchQuery(strategy.replaceAll('{STAR}', STAR), language), 1);
    url.searchParams.set('per_page', '1');
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'software-passport-registry-search-verify/1.0', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    let detail = '';
    if (r.status !== 200) { failures += 1; try { const j: any = await r.json(); detail = ' ' + JSON.stringify(j.errors ?? j.message); } catch { /* body not JSON */ } }
    else { const j: any = await r.json(); detail = ` total=${j.total_count}`; }
    console.log(`q${i} ${language.padEnd(10)} HTTP ${r.status}${detail}   q="${url.searchParams.get('q')}"`);
    await new Promise((res) => setTimeout(res, PAUSE_MS));
  }
}
console.log(failures ? `\n${failures} request(s) were not 200` : '\nAll GitHub Search requests returned 200');
process.exit(failures ? 1 : 0);
