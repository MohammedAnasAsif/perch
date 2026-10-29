// Stops the agent's web reader from reaching the user's own network (SSRF):
// only public http(s) sites on standard ports, checked again after every
// redirect. See tests/guards.test.ts.
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
] as const) {
  blocked.addSubnet(net, bits, 'ipv6');
}

export function isPublicAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '').toLowerCase();
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(addr);
  if (family === 4) return !blocked.check(addr, 'ipv4');
  if (family === 6) return !blocked.check(addr, 'ipv6');
  return false;
}

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

/** Null if the URL may be fetched, otherwise a reason. */
export async function checkUrl(raw: string, resolve: Resolver = defaultResolver): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'That is not a valid web address.';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https pages can be read.';
  if (!ALLOWED_PORTS.has(u.port)) return 'Only standard web ports can be used.';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) return 'That is not a valid web address.';
  if (/^localhost$|\.localhost$|\.local$|\.internal$|\.lan$/i.test(host)) return 'Addresses on your local network are not allowed.';

  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await resolve(host);
    } catch {
      return `Couldn't find the site ${host}.`;
    }
  }
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a))) {
    return 'Addresses on your local network are not allowed.';
  }
  return null;
}

/** fetch() that re-checks every redirect target. */
export async function guardedFetch(url: string, init: RequestInit = {}, resolve: Resolver = defaultResolver): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const problem = await checkUrl(current, resolve);
    if (problem) throw new Error(problem);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current).href;
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects.');
}
