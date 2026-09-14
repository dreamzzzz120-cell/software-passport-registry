import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUERIES, LANGUAGES, advanceCursor, buildGithubSearchQuery, classifyGithubSearchStatus,
  githubLanguageQualifier, githubSearchUrl, normalizeSearchStrategy,
} from '../src/agents/public-repository-team-v2.ts';

const STAR = (q: string) => q.replaceAll('{STAR}', '50');

// The validation rule GitHub Search applied in production on 2026-09-14
// (reproduced against api.github.com): `topics:` is a numeric count
// qualifier, so `topics:security` -> 422 '"security" is not a numeric value'.
// `topic:<name>` is the name qualifier. Encoded `q` must decode back to the
// intended query, and a raw '#' in the URL would truncate it as a fragment.
function githubWouldReject(url: URL): string | null {
  if (url.hash) return 'fragment: "#" reached the URL unencoded';
  const q = url.searchParams.get('q') ?? '';
  for (const token of q.split(/\s+/)) {
    const m = token.match(/^topics:(.+)$/);
    if (m && !/^[<>=]*\d+(\.\.\d+)?$/.test(m[1])) return `"${m[1]}" is not a numeric value`;
  }
  return null;
}

describe('public repository team: GitHub Search query construction', () => {
  it('leaves ordinary language names unquoted and unchanged', () => {
    for (const language of ['JavaScript', 'TypeScript', 'Python', 'Go', 'Java', 'Rust', 'Ruby', 'PHP', 'Kotlin', 'Swift', 'Scala', 'Dart', 'Elixir']) {
      expect(githubLanguageQualifier(language)).toBe(`language:${language}`);
    }
  });

  it('quotes C# and C++ (and any name with non-identifier characters)', () => {
    expect(githubLanguageQualifier('C#')).toBe('language:"C#"');
    expect(githubLanguageQualifier('C++')).toBe('language:"C++"');
    expect(githubLanguageQualifier('Emacs Lisp')).toBe('language:"Emacs Lisp"');
    expect(githubLanguageQualifier('C"#')).toBe('language:"C#"');
  });

  it('encodes C# so "#" is never a URL fragment and the query round-trips exactly', () => {
    const query = buildGithubSearchQuery(STAR(DEFAULT_QUERIES[0]), 'C#');
    const url = githubSearchUrl(query, 1);
    expect(url.hash).toBe('');
    expect(url.search).toContain('language%3A%22C%23%22');
    expect(url.searchParams.get('q')).toBe('stars:>=50 archived:false fork:false language:"C#"');
    expect(githubWouldReject(url)).toBeNull();
  });

  it('encodes C++ so "+" survives decoding instead of becoming a space', () => {
    const query = buildGithubSearchQuery(STAR(DEFAULT_QUERIES[0]), 'C++');
    const url = githubSearchUrl(query, 1);
    expect(url.search).toContain('C%2B%2B');
    expect(url.searchParams.get('q')).toBe('stars:>=50 archived:false fork:false language:"C++"');
    expect(githubWouldReject(url)).toBeNull();
  });

  it('sends sort/order/per_page/page exactly as before', () => {
    const url = githubSearchUrl('stars:>=50 language:Go', 3);
    expect(url.origin + url.pathname).toBe('https://api.github.com/search/repositories');
    expect(url.searchParams.get('sort')).toBe('stars');
    expect(url.searchParams.get('order')).toBe('desc');
    expect(url.searchParams.get('per_page')).toBe('100');
    expect(url.searchParams.get('page')).toBe('3');
  });

  it('uses the topic name qualifier: no default strategy carries a non-numeric topics: value', () => {
    for (const strategy of DEFAULT_QUERIES) expect(strategy).not.toMatch(/(^|\s)topics:(?![<>=]?\d)/);
    expect(DEFAULT_QUERIES.filter((s) => /(^|\s)topic:[a-z]/.test(s))).toHaveLength(5);
  });

  it('normalises a configured topics:<name> mistake to topic:<name> and keeps numeric topics: counts', () => {
    expect(normalizeSearchStrategy('topics:security stars:>=50 archived:false fork:false')).toBe('topic:security stars:>=50 archived:false fork:false');
    expect(normalizeSearchStrategy('stars:>=50 topics:devtools')).toBe('stars:>=50 topic:devtools');
    expect(normalizeSearchStrategy('topics:>3 stars:>=50')).toBe('topics:>3 stars:>=50');
    expect(normalizeSearchStrategy('topics:2 topic:ai')).toBe('topics:2 topic:ai');
    expect(normalizeSearchStrategy('topic:ai stars:>=50')).toBe('topic:ai stars:>=50');
  });

  it("every default strategy x every configured language passes GitHub's validation rule (no 422)", () => {
    const combos = DEFAULT_QUERIES.flatMap((s) => LANGUAGES.map((l) => [s, l] as const));
    expect(combos).toHaveLength(DEFAULT_QUERIES.length * LANGUAGES.length);
    for (const [strategy, language] of combos) {
      const url = githubSearchUrl(buildGithubSearchQuery(STAR(strategy), language), 1);
      expect(githubWouldReject(url), `${strategy} / ${language}`).toBeNull();
    }
  });

  it('the validator reproduces the production failure on the old strategy text', () => {
    const old = githubSearchUrl('topics:security stars:>=50 archived:false fork:false language:"C#"', 1);
    expect(githubWouldReject(old)).toBe('"security" is not a numeric value');
    // and the normaliser is what turns that into an accepted query
    const fixed = githubSearchUrl(buildGithubSearchQuery('topics:security stars:>=50 archived:false fork:false', 'C#'), 1);
    expect(githubWouldReject(fixed)).toBeNull();
  });
});

describe('public repository team: 422 handling', () => {
  it('classifies GitHub statuses so a 422 is a deterministic invalid query, not a retryable error', () => {
    expect(classifyGithubSearchStatus(200)).toBe('ok');
    expect(classifyGithubSearchStatus(403)).toBe('rate_limited');
    expect(classifyGithubSearchStatus(429)).toBe('rate_limited');
    expect(classifyGithubSearchStatus(422)).toBe('invalid_query');
    expect(classifyGithubSearchStatus(500)).toBe('error');
    expect(classifyGithubSearchStatus(502)).toBe('error');
  });

  it('an invalid query advances the cursor instead of pinning it (next query, page 1, next language)', () => {
    const stuck = { strategyIndex: 0, queryIndex: 1, page: 1, languageIndex: 1 };
    expect(advanceCursor(stuck, 0, 6)).toEqual({ strategyIndex: 0, queryIndex: 2, page: 1, languageIndex: 2 });
  });

  it('rolls the strategy over after the last query and wraps the language list', () => {
    expect(advanceCursor({ strategyIndex: 0, queryIndex: 5, page: 1, languageIndex: LANGUAGES.length - 1 }, 0, 6))
      .toEqual({ strategyIndex: 1, queryIndex: 0, page: 1, languageIndex: 0 });
  });

  it('keeps paging the same query and language while results fill a page, up to the page cap', () => {
    expect(advanceCursor({ strategyIndex: 0, queryIndex: 0, page: 1, languageIndex: 0 }, 100, 6)).toEqual({ strategyIndex: 0, queryIndex: 0, page: 2, languageIndex: 0 });
    expect(advanceCursor({ strategyIndex: 0, queryIndex: 0, page: 10, languageIndex: 0 }, 100, 6)).toEqual({ strategyIndex: 0, queryIndex: 1, page: 1, languageIndex: 1 });
    expect(advanceCursor({ strategyIndex: 0, queryIndex: 0, page: 2, languageIndex: 0 }, 40, 6)).toEqual({ strategyIndex: 0, queryIndex: 1, page: 1, languageIndex: 1 });
  });
});
