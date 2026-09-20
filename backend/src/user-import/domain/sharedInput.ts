import { createHash } from 'node:crypto';
import { detectPlatform, parseSupportedVideoUrl } from '../../pipeline/sourceIdentity';
import { canonicalizeProductUrl } from '../../pipeline/urlCanonicalization';
import { validHttpUrl } from '../../shopping/urlValidation';
import { isPubliclyRoutableHost } from './hostSafety';

/**
 * Normalizes what a user shared into Mystash: a raw URL, or text containing one.
 *
 * Phase 1 validates URL shape only — nothing is fetched, no product is extracted,
 * and no source identity is resolved beyond reusing `parseSupportedVideoUrl` for
 * canonical YouTube / Instagram forms.
 */

/** Android share payloads are small; anything larger is not a link. */
export const MAX_SHARED_INPUT_LENGTH = 4000;

export type SharedInputRejection =
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LONG'
  | 'NO_URL_FOUND'
  | 'UNSUPPORTED_SCHEME'
  | 'MALFORMED_URL'
  | 'CREDENTIALS_IN_URL'
  | 'PRIVATE_DESTINATION';

export type NormalizedSharedInput = {
  /** Original shared text, trimmed and preserved verbatim. */
  rawInput: string;
  /** The URL extracted from the shared text. */
  sourceUrl: string;
  /** Tracking-stripped / canonical form used for idempotency. */
  normalizedUrl: string;
  /** Platform hint from existing helpers; `unknown` for any other host. */
  platform: 'youtube' | 'instagram' | 'unknown';
};

export type SharedInputResult =
  | { ok: true; value: NormalizedSharedInput }
  | { ok: false; reason: SharedInputRejection };

const URL_TOKEN_RE = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const SCHEME_WITHOUT_AUTHORITY_RE = /^[a-z][a-z0-9+.-]*:[^/\s]/i;
const TRAILING_PUNCTUATION_RE = /[.,!?;:'"“”’)\]}>|]+$/;

function fail(reason: SharedInputRejection): SharedInputResult {
  return { ok: false, reason };
}

/** Shared text usually wraps the link in prose punctuation. */
function trimUrlToken(token: string): string {
  let cleaned = token.trim();
  let previous = '';
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(TRAILING_PUNCTUATION_RE, '');
  }
  return cleaned;
}

export function normalizeSharedInput(raw: unknown): SharedInputResult {
  if (typeof raw !== 'string') return fail('EMPTY_INPUT');
  const rawInput = raw.trim();
  if (!rawInput) return fail('EMPTY_INPUT');
  if (rawInput.length > MAX_SHARED_INPUT_LENGTH) return fail('INPUT_TOO_LONG');

  const tokens = (rawInput.match(URL_TOKEN_RE) ?? []).map(trimUrlToken);
  if (tokens.length === 0) {
    // `javascript:`, `data:`, `mailto:` and friends carry no `//` authority.
    const schemeOnly = rawInput
      .split(/\s+/)
      .some((word) => SCHEME_WITHOUT_AUTHORITY_RE.test(word));
    return fail(schemeOnly ? 'UNSUPPORTED_SCHEME' : 'NO_URL_FOUND');
  }

  const httpToken = tokens.find((token) => /^https?:\/\//i.test(token));
  if (!httpToken) return fail('UNSUPPORTED_SCHEME');

  const sourceUrl = validHttpUrl(httpToken);
  if (!sourceUrl) return fail('MALFORMED_URL');

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return fail('MALFORMED_URL');
  }
  if (parsed.username || parsed.password) return fail('CREDENTIALS_IN_URL');
  if (!parsed.hostname) return fail('MALFORMED_URL');
  if (!isPubliclyRoutableHost(parsed.hostname)) return fail('PRIVATE_DESTINATION');

  const identity = parseSupportedVideoUrl(sourceUrl);

  return {
    ok: true,
    value: {
      rawInput,
      sourceUrl,
      normalizedUrl: identity ? identity.canonicalUrl : canonicalizeProductUrl(sourceUrl),
      platform: identity?.platform ?? detectPlatform(sourceUrl),
    },
  };
}

/** Bounded idempotency key for the `(user_id, dedupe_key)` uniqueness constraint. */
export function userImportDedupeKey(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}
