import type { ContentSourceRecord } from '../../content-source/domain/types';
import type { ProductPageSource, ProductPageSourceKind } from './types';

export function productPageSourceKind(
  platform: ContentSourceRecord['platform'],
): ProductPageSourceKind {
  if (platform === 'instagram') return 'reel';
  if (platform === 'youtube') return 'short';
  return 'page';
}

export function productPageSourceLabel(kind: ProductPageSourceKind): string {
  if (kind === 'reel') return 'Found from this Reel';
  if (kind === 'short') return 'Found from this Short';
  return 'Found from this page';
}

export function mapContentSourceToPageSource(
  source: ContentSourceRecord,
  userImportId: string | null,
): ProductPageSource {
  const kind = productPageSourceKind(source.platform);
  return {
    contentSourceId: source.id,
    userImportId,
    kind,
    label: productPageSourceLabel(kind),
    url: source.canonicalUrl,
    title: null,
    collectionId: null,
  };
}

export function extractSpecifications(metadata: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!metadata || typeof metadata !== 'object') return {};
  const raw = metadata.specifications;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const specs: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) specs[key] = value.trim();
    else if (typeof value === 'number' || typeof value === 'boolean') specs[key] = String(value);
  }
  return specs;
}

export function extractGallery(
  metadata: Record<string, unknown> | null | undefined,
  hero: string | null,
): string[] {
  const urls: string[] = [];
  const gallery = metadata && typeof metadata === 'object' ? metadata.gallery : null;
  if (Array.isArray(gallery)) {
    for (const item of gallery) {
      if (typeof item === 'string' && item.startsWith('http')) urls.push(item);
    }
  }
  if (hero && hero.startsWith('http') && !urls.includes(hero)) urls.unshift(hero);
  return urls;
}
