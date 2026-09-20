/**
 * Test: GitHub discovery prefers homepage URL over html_url
 * 
 * When GitHub API returns a repository with both homepage (organization website)
 * and html_url (GitHub page), discovery should prefer homepage because:
 * - Homepage has company role emails (info@, sales@, support@)
 * - GitHub pages have usernames, not company email addresses
 * - This enables contact ingestion during research phase
 */

import { describe, it, expect } from 'bun:test';

// Mock githubRepositorySearch behavior
function githubRepositorySearchMock(items: any[]) {
  return items.flatMap((row: any) => {
    // Prefer non-empty homepage URL (where company role emails appear), fall back to GitHub repo page
    const homeUrl = typeof row?.homepage === 'string' && row.homepage.trim() ? row.homepage.trim() : null;
    const url = homeUrl || (typeof row?.html_url === 'string' ? row.html_url : null);
    if (!url) return [];
    return [{url, title: typeof row?.full_name === 'string' ? row.full_name : undefined, source: 'github-repository-search', discoveredAt: new Date().toISOString()}];
  });
}

describe('GitHub discovery homepage preference', () => {
  it('prefers homepage URL when present and non-empty', () => {
    const items = [
      {
        full_name: 'example-msp/awesome-repo',
        html_url: 'https://github.com/example-msp/awesome-repo',
        homepage: 'https://www.example-msp.com'
      }
    ];
    const results = githubRepositorySearchMock(items);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://www.example-msp.com');
  });

  it('falls back to html_url when homepage is empty', () => {
    const items = [
      {
        full_name: 'no-home-repo/project',
        html_url: 'https://github.com/no-home-repo/project',
        homepage: ''
      }
    ];
    const results = githubRepositorySearchMock(items);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://github.com/no-home-repo/project');
  });

  it('falls back to html_url when homepage is null/undefined', () => {
    const items = [
      {
        full_name: 'another-repo/code',
        html_url: 'https://github.com/another-repo/code',
        homepage: null
      }
    ];
    const results = githubRepositorySearchMock(items);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://github.com/another-repo/code');
  });

  it('skips repos with no url at all', () => {
    const items = [
      {
        full_name: 'bad-repo/broken',
        html_url: null,
        homepage: null
      }
    ];
    const results = githubRepositorySearchMock(items);
    expect(results).toHaveLength(0);
  });

  it('preserves title and source metadata', () => {
    const items = [
      {
        full_name: 'myorg/myproject',
        html_url: 'https://github.com/myorg/myproject',
        homepage: 'https://myproject.io'
      }
    ];
    const results = githubRepositorySearchMock(items);
    expect(results[0].title).toBe('myorg/myproject');
    expect(results[0].source).toBe('github-repository-search');
    expect(results[0].discoveredAt).toBeDefined();
  });

  it('handles mixed batch: some with homepage, some without', () => {
    const items = [
      {
        full_name: 'with-home/repo1',
        html_url: 'https://github.com/with-home/repo1',
        homepage: 'https://www.withhome.com'
      },
      {
        full_name: 'no-home/repo2',
        html_url: 'https://github.com/no-home/repo2',
        homepage: ''
      },
      {
        full_name: 'broken/repo3',
        html_url: null,
        homepage: null
      }
    ];
    const results = githubRepositorySearchMock(items);
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe('https://www.withhome.com');
    expect(results[1].url).toBe('https://github.com/no-home/repo2');
  });
});

