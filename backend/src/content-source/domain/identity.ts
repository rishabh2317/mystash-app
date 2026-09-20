import { parseSupportedVideoUrl } from '../../pipeline/sourceIdentity';
import {
  canonicalizeProductUrl,
  externalIdForProductUrl,
} from '../../pipeline/urlCanonicalization';
import type { ContentSourceIdentity } from './types';

/**
 * Maps a video content source onto the existing `video_extraction_cache` lookup.
 *
 * Phase 2 does not read or write the cache — it only stores identity in the same
 * `(platform, external_id)` shape `buildCacheKey` / `getVideoExtractionCache` already use,
 * so Phase 3 can call those helpers without a second normalizer.
 */
export function videoExtractionCacheLookup(
  identity: ContentSourceIdentity,
): { platform: string; externalVideoId: string } | null {
  if (identity.mediaKind !== 'VIDEO') return null;
  return { platform: identity.platform, externalVideoId: identity.externalId };
}

/**
 * Resolves the global identity of shared content.
 *
 * Reuses the existing helpers rather than adding a second canonicalization:
 * `parseSupportedVideoUrl` for supported videos (stable `(platform, external_id)`),
 * and the existing canonical-URL identity for everything else. Both are pure — no
 * fetching and no DNS.
 *
 * Input is expected to be the already-validated `normalizedUrl` from
 * `normalizeSharedInput`; both helpers are idempotent, so re-normalizing is safe.
 */
export function resolveContentSourceIdentity(normalizedUrl: string): ContentSourceIdentity {
  const video = parseSupportedVideoUrl(normalizedUrl);
  if (video) {
    return {
      platform: video.platform,
      externalId: video.externalId,
      canonicalUrl: video.canonicalUrl,
      mediaKind: 'VIDEO',
    };
  }

  const canonicalUrl = canonicalizeProductUrl(normalizedUrl);
  return {
    platform: 'web',
    externalId: externalIdForProductUrl(canonicalUrl),
    canonicalUrl,
    mediaKind: 'WEB_PAGE',
  };
}
