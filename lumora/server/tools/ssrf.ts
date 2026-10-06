// SSRF-hardened fetch for user/model-provided URLs: public http(s) hosts only, no private networks,
// manual redirect handling with re-validation, size and time limits.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

function inRange(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return BLOCKED_V4.some((c) => inRange(ip, c));
  if (v === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') ||
      lower.startsWith('ff') ||
      lower.startsWith('64:ff9b') ||
      lower.startsWith('2001:db8')
    );
  }
  return true;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('URLs with credentials are not allowed');
  if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) throw new UnsafeUrlError('Port not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new UnsafeUrlError('Host not allowed');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new UnsafeUrlError('Host could not be resolved');
  if (addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError('Private network addresses are not allowed');
  return url;
}

export async function safeFetch(
  raw: string,
  opts: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<{ url: string; status: number; contentType: string; body: string; truncated: boolean }> {
  const { timeoutMs = 10_000, maxBytes = 2_000_000 } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': 'LumoraBot/1.0 (+personal AI assistant; respects robots via user-initiated fetch)',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5',
        ...opts.headers,
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    const contentType = res.headers.get('content-type') ?? '';
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks));
    return { url: url.toString(), status: res.status, contentType, body, truncated };
  }
  throw new UnsafeUrlError('Too many redirects');
}
