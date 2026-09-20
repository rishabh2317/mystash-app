/**
 * Share capture input layer (Discover Anywhere, Phase 1).
 *
 * The Android share target hands raw shared text to `/import` as a deep link. This
 * module extracts and shape-checks the link before it is submitted. The backend
 * re-validates and remains authoritative; these checks exist so the screen can fail
 * fast and locally without a round trip.
 *
 * Phase 1 does not fetch the link, identify products, or touch the Bag.
 */

import { firstParam } from '@/src/navigation/authIntent';

/** Matches the native share-intent cap and the backend input limit. */
export const MAX_SHARED_INPUT_LENGTH = 4000;

export const SHARE_IMPORT_COPY = {
  /** Deliberately does not claim the product was identified or saved to the Bag. */
  acknowledgement: 'Got it — Mystash received your link.',
  acknowledgementDetail: 'You can close this and keep browsing.',
  pending: 'Sending your link to Mystash…',
  signedOut: 'Sign in to send links to Mystash.',
  signedOutAction: 'Sign in',
  doneAction: 'Done',
  retryAction: 'Try again',
  genericError: 'Mystash could not accept that link.',
} as const;

export type SharedLinkRejection =
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LONG'
  | 'NO_URL_FOUND'
  | 'UNSUPPORTED_SCHEME'
  | 'MALFORMED_URL'
  | 'PRIVATE_DESTINATION';

export type SharedLinkResult =
  | { ok: true; url: string; rawInput: string }
  | { ok: false; reason: SharedLinkRejection };

const REJECTION_COPY: Record<SharedLinkRejection, string> = {
  EMPTY_INPUT: 'Nothing was shared.',
  INPUT_TOO_LONG: 'That share is too long to import.',
  NO_URL_FOUND: 'That share did not contain a link.',
  UNSUPPORTED_SCHEME: 'Only web links can be sent to Mystash.',
  MALFORMED_URL: 'That link is not valid.',
  PRIVATE_DESTINATION: 'That link cannot be imported.',
};

const URL_TOKEN_RE = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const SCHEME_WITHOUT_AUTHORITY_RE = /^[a-z][a-z0-9+.-]*:[^/\s]/i;
const TRAILING_PUNCTUATION_RE = /[.,!?;:'"“”’)\]}>|]+$/;

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

function trimUrlToken(token: string): string {
  let cleaned = token.trim();
  let previous = '';
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(TRAILING_PUNCTUATION_RE, '');
  }
  return cleaned;
}

/** Client-side mirror of the backend host policy; the backend is authoritative. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost') return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (host.startsWith('[')) return !/^\[[23]/.test(host);

  const labels = host.split('.');
  if (labels.length < 2) return true;
  if (!labels.every((label) => /^\d{1,3}$/.test(label))) return false;
  if (labels.length !== 4) return true;

  const [a, b] = labels.map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || b === 0)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Extracts the first web link from a shared payload (raw URL or text around one). */
export function extractSharedLink(raw: string | null | undefined): SharedLinkResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'EMPTY_INPUT' };
  const rawInput = raw.trim();
  if (!rawInput) return { ok: false, reason: 'EMPTY_INPUT' };
  if (rawInput.length > MAX_SHARED_INPUT_LENGTH) return { ok: false, reason: 'INPUT_TOO_LONG' };

  const tokens = (rawInput.match(URL_TOKEN_RE) ?? []).map(trimUrlToken);
  if (tokens.length === 0) {
    const schemeOnly = rawInput
      .split(/\s+/)
      .some((word) => SCHEME_WITHOUT_AUTHORITY_RE.test(word));
    return { ok: false, reason: schemeOnly ? 'UNSUPPORTED_SCHEME' : 'NO_URL_FOUND' };
  }

  const httpToken = tokens.find((token) => /^https?:\/\//i.test(token));
  if (!httpToken) return { ok: false, reason: 'UNSUPPORTED_SCHEME' };

  let parsed: URL;
  try {
    parsed = new URL(httpToken);
  } catch {
    return { ok: false, reason: 'MALFORMED_URL' };
  }
  if (!parsed.hostname) return { ok: false, reason: 'MALFORMED_URL' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'PRIVATE_DESTINATION' };
  if (isPrivateHost(parsed.hostname)) return { ok: false, reason: 'PRIVATE_DESTINATION' };

  return { ok: true, url: httpToken, rawInput };
}

export function sharedLinkMessage(reason: SharedLinkRejection): string {
  return REJECTION_COPY[reason];
}

/** Reads the shared payload off `mystash://import?text=…` route params. */
export function sharedTextFromImportParams(params: {
  text?: string | string[];
  url?: string | string[];
}): string | null {
  const value = firstParam(params.text) ?? firstParam(params.url);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
