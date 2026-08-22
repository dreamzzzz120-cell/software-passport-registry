import { lookup } from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 0;

function ipv4ToNumber(ip: string): number {
  return ip.split('.').reduce((n, octet) => (n * 256) + Number(octet), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToNumber(ip);
  const ranges: Array<[number, number]> = [
    [ipv4ToNumber('0.0.0.0'), ipv4ToNumber('0.255.255.255')],
    [ipv4ToNumber('10.0.0.0'), ipv4ToNumber('10.255.255.255')],
    [ipv4ToNumber('100.64.0.0'), ipv4ToNumber('100.127.255.255')],
    [ipv4ToNumber('127.0.0.0'), ipv4ToNumber('127.255.255.255')],
    [ipv4ToNumber('169.254.0.0'), ipv4ToNumber('169.254.255.255')],
    [ipv4ToNumber('172.16.0.0'), ipv4ToNumber('172.31.255.255')],
    [ipv4ToNumber('192.0.0.0'), ipv4ToNumber('192.0.0.255')],
    [ipv4ToNumber('192.0.2.0'), ipv4ToNumber('192.0.2.255')],
    [ipv4ToNumber('192.168.0.0'), ipv4ToNumber('192.168.255.255')],
    [ipv4ToNumber('198.18.0.0'), ipv4ToNumber('198.19.255.255')],
    [ipv4ToNumber('198.51.100.0'), ipv4ToNumber('198.51.100.255')],
    [ipv4ToNumber('203.0.113.0'), ipv4ToNumber('203.0.113.255')],
    [ipv4ToNumber('224.0.0.0'), ipv4ToNumber('255.255.255.255')],
  ];
  return ranges.some(([start, end]) => n >= start && n <= end);
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split('%')[0];
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    return net.isIP(mapped) === 4 && isPrivateIpv4(mapped);
  }
  if (/^2001:db8(?::|$)/.test(normalized)) return true;
  if (/^2001:2(?::|$)/.test(normalized)) return true;
  if (/^2001:10(?::|$)/.test(normalized)) return true;
  if (/^2002:(?:[0-9a-f]{1,4}:){0,1}/.test(normalized)) return true;
  if (/^64:ff9b:(?::|$)/.test(normalized)) return true;
  return false;
}

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  return family === 4 ? isPrivateIpv4(address) : family === 6 ? isBlockedIpv6(address) : true;
}

export async function validateWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Webhook URL is invalid');
  }

  if (url.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS');
  if (url.username || url.password) throw new Error('Webhook URL cannot contain credentials');
  if (url.port && url.port !== '443') throw new Error('Webhook URL must use port 443');
  if (url.hash) throw new Error('Webhook URL cannot contain a fragment');
  if (MAX_REDIRECTS !== 0) throw new Error('Webhook redirect policy is invalid');

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Webhook destination is not publicly routable');
  }

  const directFamily = net.isIP(host);
  if (directFamily && isBlockedAddress(host)) throw new Error('Webhook destination is not publicly routable');

  const records = await lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(record => isBlockedAddress(record.address))) {
    throw new Error('Webhook destination resolves to a blocked network address');
  }

  return url;
}
