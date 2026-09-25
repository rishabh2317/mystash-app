import { parseSupportedVideoUrl } from '../../pipeline/sourceIdentity';
import { validHttpUrl } from '../../shopping/urlValidation';
import type { ContentSourceRecord } from '../../content-source/domain/types';
import { productPageSourceKind } from './map';
import type { ProductPageRelatedMedia, ProductPageSource, ProductPageSourceKind } from './types';

export function relatedMediaLabel(kind: ProductPageSourceKind): string {
  if (kind === 'reel') return 'Instagram Reel';
  if (kind === 'short') return 'YouTube Short';
  return 'Related page';
}

export function isUsableMediaUrl(url: string | null | undefined): url is string {
  return Boolean(validHttpUrl(url));
}

/** Identity for dedupe / original exclusion — video id when known, else normalized URL. */
export function mediaIdentityKey(
  url: string,
  platform?: string | null,
  externalId?: string | null,
): string {
  const plat = platform?.trim().toLowerCase() ?? '';
  const ext = externalId?.trim() ?? '';
  if ((plat === 'youtube' || plat === 'instagram') && ext) {
    return `${plat}:${ext.toLowerCase()}`;
  }
  const parsed = parseSupportedVideoUrl(url);
  if (parsed) return `${parsed.platform}:${parsed.externalId.toLowerCase()}`;
  const http = validHttpUrl(url);
  if (!http) return '';
  try {
    const parsedUrl = new URL(http);
    parsedUrl.hash = '';
    parsedUrl.hostname = parsedUrl.hostname.replace(/^www\./i, '').toLowerCase();
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
    parsedUrl.search = '';
    return `url:${parsedUrl.toString()}`;
  } catch {
    return `url:${http}`;
  }
}

export function contentSourceToRelatedMedia(source: ContentSourceRecord): ProductPageRelatedMedia | null {
  if (!isUsableMediaUrl(source.canonicalUrl)) return null;
  const kind = productPageSourceKind(source.platform);
  return {
    id: source.id,
    kind,
    label: relatedMediaLabel(kind),
    url: source.canonicalUrl,
    title: null,
    thumbnailUrl: null,
    collectionId: null,
    creator: null,
    views: 0,
    saves: 0,
  };
}

export function excludeOriginalMedia(
  items: ProductPageRelatedMedia[],
  original: Pick<ProductPageSource, 'url' | 'contentSourceId'> | ProductPageSource | null,
): ProductPageRelatedMedia[] {
  if (!original) return items;
  const originalKey = mediaIdentityKey(original.url);
  return items.filter((item) => {
    if (item.id === original.contentSourceId) return false;
    const key = mediaIdentityKey(item.url);
    return Boolean(key) && key !== originalKey;
  });
}

export function dedupeRelatedMedia(items: ProductPageRelatedMedia[]): ProductPageRelatedMedia[] {
  const seen = new Set<string>();
  const out: ProductPageRelatedMedia[] = [];
  for (const item of items) {
    if (!isUsableMediaUrl(item.url)) continue;
    const key = mediaIdentityKey(item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function finalizeRelatedMedia(
  items: ProductPageRelatedMedia[],
  original: ProductPageSource | null,
  limit: number,
): ProductPageRelatedMedia[] {
  return dedupeRelatedMedia(excludeOriginalMedia(items, original)).slice(0, Math.max(0, limit));
}
