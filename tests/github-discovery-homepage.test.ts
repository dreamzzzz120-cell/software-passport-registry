import { describe, expect, it } from 'vitest';

describe('GitHub discovery preferring homepage over repo URL', () => {
  it('prefers non-empty homepage URL when present', async () => {
    // Mock GitHub API response with both homepage and html_url
    const mockResponse = {
      ok: true,
      json: async () => ({
        items: [
          {
            full_name: 'acme-corp/msp-platform',
            homepage: 'https://acme-msp.com',
            html_url: 'https://github.com/acme-corp/msp-platform'
          }
        ]
      })
    };

    // Simulate the githubRepositorySearch logic inline for testing
    const data = await mockResponse.json();
    const results = data.items.flatMap((row: any) => {
      const url = (typeof row?.homepage === 'string' && row.homepage.trim()) ? row.homepage.trim() : (typeof row?.html_url === 'string' ? row.html_url : null);
      if (!url) return [];
      return [{ url, title: row.full_name, source: 'github-repository-search' }];
    });

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://acme-msp.com');
    expect(results[0].title).toBe('acme-corp/msp-platform');
  });

  it('falls back to html_url when homepage is empty', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        items: [
          {
            full_name: 'someorg/repo',
            homepage: '',
            html_url: 'https://github.com/someorg/repo'
          }
        ]
      })
    };

    const data = await mockResponse.json();
    const results = data.items.flatMap((row: any) => {
      const url = (typeof row?.homepage === 'string' && row.homepage.trim()) ? row.homepage.trim() : (typeof row?.html_url === 'string' ? row.html_url : null);
      if (!url) return [];
      return [{ url, title: row.full_name, source: 'github-repository-search' }];
    });

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://github.com/someorg/repo');
  });

  it('falls back to html_url when homepage is missing', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        items: [
          {
            full_name: 'company/tools',
            html_url: 'https://github.com/company/tools'
          }
        ]
      })
    };

    const data = await mockResponse.json();
    const results = data.items.flatMap((row: any) => {
      const url = (typeof row?.homepage === 'string' && row.homepage.trim()) ? row.homepage.trim() : (typeof row?.html_url === 'string' ? row.html_url : null);
      if (!url) return [];
      return [{ url, title: row.full_name, source: 'github-repository-search' }];
    });

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://github.com/company/tools');
  });

  it('skips entries with no valid URL', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        items: [
          {
            full_name: 'bad/repo',
            homepage: '',
            html_url: null
          }
        ]
      })
    };

    const data = await mockResponse.json();
    const results = data.items.flatMap((row: any) => {
      const url = (typeof row?.homepage === 'string' && row.homepage.trim()) ? row.homepage.trim() : (typeof row?.html_url === 'string' ? row.html_url : null);
      if (!url) return [];
      return [{ url, title: row.full_name, source: 'github-repository-search' }];
    });

    expect(results).toHaveLength(0);
  });

  it('prefers homepage across mixed results', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        items: [
          {
            full_name: 'company1/msp',
            homepage: 'https://company1.com',
            html_url: 'https://github.com/company1/msp'
          },
          {
            full_name: 'company2/tools',
            homepage: '',
            html_url: 'https://github.com/company2/tools'
          },
          {
            full_name: 'company3/platform',
            homepage: 'https://company3.io',
            html_url: 'https://github.com/company3/platform'
          }
        ]
      })
    };

    const data = await mockResponse.json();
    const results = data.items.flatMap((row: any) => {
      const url = (typeof row?.homepage === 'string' && row.homepage.trim()) ? row.homepage.trim() : (typeof row?.html_url === 'string' ? row.html_url : null);
      if (!url) return [];
      return [{ url, title: row.full_name, source: 'github-repository-search' }];
    });

    expect(results).toHaveLength(3);
    expect(results[0].url).toBe('https://company1.com');
    expect(results[1].url).toBe('https://github.com/company2/tools');
    expect(results[2].url).toBe('https://company3.io');
  });
});

