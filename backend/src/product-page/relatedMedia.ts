import type { SupabaseClient } from '@supabase/supabase-js';
import { validHttpUrl } from '../shopping/urlValidation';
import { relatedMediaLabel } from './domain/media';
import type { ProductPageRelatedMedia, ProductPageSourceKind } from './domain/types';
import type { ProductPageRelatedMediaPort } from './ports';

function kindFromProvider(provider: string | null | undefined): ProductPageSourceKind {
  const value = provider?.trim().toLowerCase() ?? '';
  if (value.includes('instagram')) return 'reel';
  if (value.includes('youtube')) return 'short';
  return 'page';
}

type MediaRow = {
  id?: unknown;
  collection_id?: unknown;
  source_url?: unknown;
  canonical_url?: unknown;
  thumbnail_url?: unknown;
  title?: unknown;
  source_provider?: unknown;
};

function mapMediaRow(
  row: MediaRow,
  published: Map<string, string | null>,
): ProductPageRelatedMedia | null {
  const collectionId = typeof row.collection_id === 'string' ? row.collection_id : null;
  if (!collectionId || !published.has(collectionId)) return null;
  const url =
    validHttpUrl(typeof row.source_url === 'string' ? row.source_url : null) ??
    validHttpUrl(typeof row.canonical_url === 'string' ? row.canonical_url : null);
  if (!url) return null;
  const kind = kindFromProvider(typeof row.source_provider === 'string' ? row.source_provider : null);
  return {
    id: typeof row.id === 'string' ? row.id : `${collectionId}:${url}`,
    kind,
    label: relatedMediaLabel(kind),
    url,
    title: (typeof row.title === 'string' && row.title) || published.get(collectionId) || null,
    thumbnailUrl: typeof row.thumbnail_url === 'string' ? row.thumbnail_url : null,
    collectionId,
  };
}

async function publishedTitles(
  admin: SupabaseClient,
  collectionIds: string[],
): Promise<Map<string, string | null>> {
  if (collectionIds.length === 0) return new Map();
  const { data, error } = await admin
    .from('collections')
    .select('id, title')
    .in('id', collectionIds)
    .eq('status', 'published');
  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [
      row.id as string,
      typeof row.title === 'string' ? row.title : null,
    ]),
  );
}

const MEDIA_COLUMNS =
  'id, collection_id, source_url, canonical_url, thumbnail_url, title, source_provider, is_primary';

/**
 * Existing collection media already tagged to this catalogue product, or matching
 * known source URLs. No new ranking — published collections, primary first.
 */
export function createSupabaseRelatedMediaPort(admin: SupabaseClient): ProductPageRelatedMediaPort {
  return {
    async listForCatalogProduct(catalogProductId, limit) {
      const { data: tags, error: tagError } = await admin
        .from('collection_product_tags')
        .select('collection_id')
        .eq('catalog_product_id', catalogProductId)
        .limit(Math.max(limit * 3, 12));
      if (tagError) throw tagError;
      const collectionIds = [
        ...new Set(
          (tags ?? [])
            .map((row) => (typeof row.collection_id === 'string' ? row.collection_id : null))
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (collectionIds.length === 0) return [];

      const published = await publishedTitles(admin, collectionIds);
      if (published.size === 0) return [];

      const { data: media, error: mediaError } = await admin
        .from('collection_media')
        .select(MEDIA_COLUMNS)
        .in('collection_id', [...published.keys()])
        .order('is_primary', { ascending: false });
      if (mediaError) throw mediaError;

      const out: ProductPageRelatedMedia[] = [];
      for (const row of media ?? []) {
        const mapped = mapMediaRow(row, published);
        if (!mapped) continue;
        out.push(mapped);
        if (out.length >= limit) break;
      }
      return out;
    },

    async listMatchingUrls(urls, limit) {
      const usable = [...new Set(urls.map((url) => validHttpUrl(url)).filter((url): url is string => Boolean(url)))];
      if (usable.length === 0) return [];

      const { data: bySource, error: sourceError } = await admin
        .from('collection_media')
        .select(MEDIA_COLUMNS)
        .in('source_url', usable);
      if (sourceError) throw sourceError;
      const { data: byCanonical, error: canonicalError } = await admin
        .from('collection_media')
        .select(MEDIA_COLUMNS)
        .in('canonical_url', usable);
      if (canonicalError) throw canonicalError;

      const rows = [...(bySource ?? []), ...(byCanonical ?? [])];
      const collectionIds = [
        ...new Set(
          rows
            .map((row) => (typeof row.collection_id === 'string' ? row.collection_id : null))
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const published = await publishedTitles(admin, collectionIds);
      if (published.size === 0) return [];

      const out: ProductPageRelatedMedia[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const mapped = mapMediaRow(row, published);
        if (!mapped || seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        out.push(mapped);
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}

export const emptyRelatedMediaPort: ProductPageRelatedMediaPort = {
  async listForCatalogProduct() {
    return [];
  },
  async listMatchingUrls() {
    return [];
  },
};
