import { describe, expect, it } from 'vitest';
import { assertPublicNetworkTarget, isBlockedIp, safeNetworkFetch } from '../src/utils/monitoring.ts';

// Real production gap, found via adversarial review: the monitoring
// 'tls'/'domain_dns'/'uptime' collectors (src/workers/trust-monitoring-worker.ts)
// let an Owner/Admin enroll an arbitrary URL, which this module fetches
// server-side -- classic SSRF surface, and it had zero test coverage before
// this file. isBlockedIp/assertPublicNetworkTarget are pure and accept an
// injectable resolver specifically so they can be tested without real DNS
// or network access.
describe('isBlockedIp', () => {
  it('blocks every RFC1918/loopback/link-local/CGNAT/reserved IPv4 range', () => {
    for (const address of ['127.0.0.1', '0.0.0.0', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255']) {
      expect(isBlockedIp(address), address).toBe(true);
    }
  });

  it('blocks IPv6 loopback, unique-local, link-local, multicast, and IPv4-mapped-private addresses', () => {
    for (const address of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:192.168.1.1']) {
      expect(isBlockedIp(address), address).toBe(true);
    }
  });

  it('does not block ordinary public IPv4/IPv6 addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isBlockedIp(address), address).toBe(false);
    }
  });
});

describe('assertPublicNetworkTarget', () => {
  const resolverFor = (addresses: { address: string; family: number }[]) => (async () => addresses) as any;

  it('rejects non-http(s) protocols before ever resolving DNS', async () => {
    await expect(assertPublicNetworkTarget('file:///etc/passwd', resolverFor([{ address: '8.8.8.8', family: 4 }]))).rejects.toThrow('TARGET_PROTOCOL_BLOCKED');
    await expect(assertPublicNetworkTarget('gopher://internal/', resolverFor([{ address: '8.8.8.8', family: 4 }]))).rejects.toThrow('TARGET_PROTOCOL_BLOCKED');
  });

  it('rejects embedded credentials (userinfo) in the URL', async () => {
    await expect(assertPublicNetworkTarget('http://admin:pass@example.com/', resolverFor([{ address: '8.8.8.8', family: 4 }]))).rejects.toThrow('TARGET_CREDENTIALS_BLOCKED');
  });

  it('rejects blocked hostnames outright, before DNS resolution', async () => {
    await expect(assertPublicNetworkTarget('http://localhost/', resolverFor([{ address: '8.8.8.8', family: 4 }]))).rejects.toThrow('TARGET_HOST_BLOCKED');
    await expect(assertPublicNetworkTarget('http://metadata.google.internal/', resolverFor([{ address: '8.8.8.8', family: 4 }]))).rejects.toThrow('TARGET_HOST_BLOCKED');
    await expect(assertPublicNetworkTarget('http://service.internal/', resolverFor([{ address: '8.8.8.8', family: 4 }]))).rejects.toThrow('TARGET_HOST_BLOCKED');
    await expect(assertPublicNetworkTarget('http://box.local/', resolverFor([{ address: '8.8.8.8', family: 4 }]))).rejects.toThrow('TARGET_HOST_BLOCKED');
  });

  it('rejects a hostname that resolves to a private/internal address (the core SSRF check)', async () => {
    await expect(assertPublicNetworkTarget('http://attacker-controlled.example/', resolverFor([{ address: '169.254.169.254', family: 4 }]))).rejects.toThrow('TARGET_NETWORK_BLOCKED');
    await expect(assertPublicNetworkTarget('http://attacker-controlled.example/', resolverFor([{ address: '10.0.0.5', family: 4 }]))).rejects.toThrow('TARGET_NETWORK_BLOCKED');
  });

  it('rejects a hostname that resolves to a mix of public and private addresses (any blocked answer fails the whole target)', async () => {
    await expect(assertPublicNetworkTarget('http://multi-answer.example/', resolverFor([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]))).rejects.toThrow('TARGET_NETWORK_BLOCKED');
  });

  it('rejects a hostname with no DNS answers at all', async () => {
    await expect(assertPublicNetworkTarget('http://nowhere.example/', resolverFor([]))).rejects.toThrow('TARGET_NETWORK_BLOCKED');
  });

  it('accepts a hostname that resolves only to public addresses, returning the resolved addresses', async () => {
    const result = await assertPublicNetworkTarget('https://example.com/health', resolverFor([{ address: '93.184.216.34', family: 4 }]));
    expect(result.addresses).toEqual(['93.184.216.34']);
    expect(result.url.hostname).toBe('example.com');
  });
});

describe('safeNetworkFetch SSRF short-circuit', () => {
  const resolverFor = (addresses: { address: string; family: number }[]) => (async () => addresses) as any;

  it('throws before making any real network request when the target resolves to a blocked address', async () => {
    await expect(safeNetworkFetch('http://attacker-controlled.example/', { resolver: resolverFor([{ address: '169.254.169.254', family: 4 }]) })).rejects.toThrow('TARGET_NETWORK_BLOCKED');
  });

  it('throws for a blocked hostname without attempting DNS resolution or a request', async () => {
    await expect(safeNetworkFetch('http://localhost:5432/', { resolver: resolverFor([{ address: '8.8.8.8', family: 4 }]) })).rejects.toThrow('TARGET_HOST_BLOCKED');
  });

  // Real regression, found via live production testing (not caught by the
  // blocking-path tests above, since those never let a request actually
  // complete): the DNS-pinning Agent's connect.lookup used the single-value
  // dns.lookup callback shape (err, address, family), but undici's own
  // connector calls it with options.all=true and expects the array shape
  // (err, [{address, family}]) -- every real request through this dispatcher
  // failed with "fetch failed" / "Invalid IP address: undefined", silently
  // turning every uptime/tls/domain_dns collector run into a false UNKNOWN
  // result instead of ever reaching the target. Skips gracefully (does not
  // fail the suite) if this environment has no outbound network access,
  // since that's a property of the sandbox, not of the code under test --
  // but runs for real whenever network access is available, which is
  // exactly the gap that let the original bug ship.
  it('actually completes a real request end-to-end through the DNS-pinned dispatcher', async () => {
    let reachable = true;
    try { await fetch('https://example.com/', { signal: AbortSignal.timeout(5000) }); } catch { reachable = false; }
    if (!reachable) return; // no outbound network in this environment; nothing to prove either way
    const result = await safeNetworkFetch('https://example.com/', { timeoutMs: 10000 });
    expect(result.response.status).toBe(200);
  }, 15000);
});
