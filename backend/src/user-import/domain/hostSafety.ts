/**
 * Host classification for user-submitted URLs.
 *
 * Phase 1 never fetches a shared URL, so no DNS resolution happens here. These are
 * literal-host checks only: they reject loopback / private / link-local / reserved
 * destinations and obfuscated numeric hosts before a URL is accepted for import.
 *
 * A later phase that actually fetches must still re-validate after DNS resolution.
 */

const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.corp',
  '.home',
  '.home.arpa',
];

function parseDecimalOctet(label: string): number | null {
  if (!/^\d{1,3}$/.test(label)) return null;
  const value = Number(label);
  return value >= 0 && value <= 255 ? value : null;
}

/** Dotted-quad only. Shorthand / hex / octal forms are handled by the caller. */
function parseIpv4(host: string): [number, number, number, number] | null {
  const labels = host.split('.');
  if (labels.length !== 4) return null;
  const octets = labels.map(parseDecimalOctet);
  if (octets.some((o) => o === null)) return null;
  return octets as [number, number, number, number];
}

function isPublicIpv4([a, b, , ]: [number, number, number, number]): boolean {
  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // private
  if (a === 127) return false; // loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
  if (a === 169 && b === 254) return false; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0) return false; // 192.0.0/24 + 192.0.2/24 documentation
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51) return false; // documentation
  if (a === 203 && b === 0) return false; // documentation
  if (a >= 224) return false; // multicast + reserved + broadcast
  return true;
}

/**
 * Conservative: only global unicast `2000::/3` is treated as public, which rejects
 * `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped loopback without enumerating them.
 */
function isPublicIpv6(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (!normalized || normalized.startsWith('::')) return false;
  const firstHextet = normalized.split(':')[0];
  if (!/^[0-9a-f]{1,4}$/.test(firstHextet)) return false;
  const value = Number.parseInt(firstHextet, 16);
  return value >= 0x2000 && value <= 0x3fff;
}

/**
 * Whether a resolved IP address is safe to connect to.
 * Used after DNS so a public hostname cannot rebind onto loopback/private space.
 */
export function isPubliclyRoutableAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (!value) return false;

  if (value.startsWith('[') && value.endsWith(']')) {
    return isPublicIpv6(value.slice(1, -1));
  }

  const ipv4 = parseIpv4(value);
  if (ipv4) return isPublicIpv4(ipv4);

  // Node may return IPv4-mapped IPv6 as ::ffff:a.b.c.d
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) {
    const inner = parseIpv4(mapped[1]);
    return inner ? isPublicIpv4(inner) : false;
  }

  return isPublicIpv6(value);
}

/**
 * Whether a URL hostname may be accepted from a user share.
 *
 * Rejects loopback/private/link-local literals, reserved suffixes, single-label
 * intranet names, and any all-numeric host that is not a public dotted quad.
 */
export function isPubliclyRoutableHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;

  // `URL.hostname` keeps brackets around IPv6 literals.
  if (host.startsWith('[') && host.endsWith(']')) {
    return isPublicIpv6(host.slice(1, -1));
  }

  const labels = host.split('.');
  if (labels.length < 2) return false; // bare intranet hostname
  if (labels.some((label) => label.length === 0)) return false;

  const allNumericLabels = labels.every((label) => /^(\d+|0x[0-9a-f]+)$/.test(label));
  if (allNumericLabels) {
    const ipv4 = parseIpv4(host);
    // Shorthand (127.1) and hex/octal forms are rejected rather than canonicalized.
    return ipv4 ? isPublicIpv4(ipv4) : false;
  }

  return true;
}
