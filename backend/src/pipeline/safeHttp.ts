import dns from 'node:dns/promises';
import {
  isPubliclyRoutableAddress,
  isPubliclyRoutableHost,
} from '../user-import/domain/hostSafety';

export const SAFE_FETCH_TIMEOUT_MS = 18_000;
export const SAFE_FETCH_MAX_BYTES = 900_000;
export const SAFE_FETCH_MAX_REDIRECTS = 5;

export class SafeHttpError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'UNSUPPORTED_SCHEME'
      | 'PRIVATE_DESTINATION'
      | 'REDIRECT_LIMIT'
      | 'TIMEOUT'
      | 'DNS_FAILED',
  ) {
    super(message);
    this.name = 'SafeHttpError';
  }
}

export type AddressResolver = (hostname: string) => Promise<string[]>;

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  resolver?: AddressResolver;
};

const DEFAULT_HEADERS = {
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};

async function defaultResolver(hostname: string): Promise<string[]> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

function parseHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SafeHttpError('That link is not a valid URL', 'UNSUPPORTED_SCHEME');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SafeHttpError('Only http and https links can be fetched', 'UNSUPPORTED_SCHEME');
  }
  if (parsed.username || parsed.password) {
    throw new SafeHttpError('That link cannot be fetched', 'PRIVATE_DESTINATION');
  }
  return parsed;
}

async function assertSafeDestination(
  parsed: URL,
  resolver: AddressResolver,
): Promise<void> {
  if (!isPubliclyRoutableHost(parsed.hostname)) {
    throw new SafeHttpError('That link cannot be fetched', 'PRIVATE_DESTINATION');
  }
  let addresses: string[];
  try {
    addresses = await resolver(parsed.hostname);
  } catch {
    throw new SafeHttpError('That link cannot be fetched', 'DNS_FAILED');
  }
  if (addresses.length === 0 || addresses.some((addr) => !isPubliclyRoutableAddress(addr))) {
    throw new SafeHttpError('That link cannot be fetched', 'PRIVATE_DESTINATION');
  }
}

/**
 * Fetch a user-controlled URL with SSRF controls: scheme, literal host, DNS, redirect
 * re-check, timeout, and response size. Redirects are followed manually so the final
 * hop is re-validated.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? SAFE_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? SAFE_FETCH_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_MAX_REDIRECTS;
  const resolver = options.resolver ?? defaultResolver;
  const headers = { ...DEFAULT_HEADERS, ...(options.headers ?? {}) };

  let current = parseHttpUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertSafeDestination(current, resolver);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current.href, {
        redirect: 'manual',
        signal: ac.signal,
        headers,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (ac.signal.aborted || /abort/i.test(msg)) {
        throw new SafeHttpError('Timed out fetching that page', 'TIMEOUT');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      if (hop === maxRedirects) {
        throw new SafeHttpError('Too many redirects', 'REDIRECT_LIMIT');
      }
      current = parseHttpUrl(new URL(location, current).href);
      continue;
    }

    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    return new Response(slice, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  throw new SafeHttpError('Too many redirects', 'REDIRECT_LIMIT');
}
