import type { ProductPageSourceKind, ProductPageView } from '@/src/types/productPage';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asKind(value: unknown): ProductPageSourceKind {
  if (value === 'reel' || value === 'short' || value === 'page') return value;
  return 'page';
}

export function hydrateProductPage(raw: unknown): ProductPageView | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const productId = asString(row.productId);
  const title = asString(row.title);
  if (!productId || !title) return null;

  const offers: ProductPageView['offers'] = [];
  if (Array.isArray(row.offers)) {
    for (const item of row.offers) {
      if (!item || typeof item !== 'object') continue;
      const offer = item as Record<string, unknown>;
      const id = asString(offer.id);
      const action = offer.action === 'buy' || offer.action === 'listing' || offer.action === 'none'
        ? offer.action
        : 'none';
      if (!id) continue;
      offers.push({
        id,
        merchant: asString(offer.merchant),
        price: asString(offer.price),
        currency: asString(offer.currency),
        availability: asString(offer.availability),
        action,
      });
    }
  }

  const relatedMedia: ProductPageView['relatedMedia'] = [];
  if (Array.isArray(row.relatedMedia)) {
    for (const item of row.relatedMedia) {
      if (!item || typeof item !== 'object') continue;
      const media = item as Record<string, unknown>;
      const id = asString(media.id);
      const url = asString(media.url);
      if (!id || !url) continue;
      relatedMedia.push({
        id,
        kind: asKind(media.kind),
        label: asString(media.label) ?? 'Related',
        url,
        title: asString(media.title),
        thumbnailUrl: asString(media.thumbnailUrl),
        collectionId: asString(media.collectionId),
        creator: (() => {
          if (!media.creator || typeof media.creator !== 'object') return null;
          const c = media.creator as Record<string, unknown>;
          const creatorId = asString(c.id);
          if (!creatorId) return null;
          return {
            id: creatorId,
            username: asString(c.username),
            displayName: asString(c.displayName),
            avatarUrl: asString(c.avatarUrl),
          };
        })(),
        views: typeof media.views === 'number' && Number.isFinite(media.views) ? Math.max(0, Math.floor(media.views)) : 0,
        saves: typeof media.saves === 'number' && Number.isFinite(media.saves) ? Math.max(0, Math.floor(media.saves)) : 0,
        fromDiscovery: media.fromDiscovery === true,
      });
    }
  }

  let source: ProductPageView['source'] = null;
  if (row.source && typeof row.source === 'object') {
    const s = row.source as Record<string, unknown>;
    const contentSourceId = asString(s.contentSourceId);
    const url = asString(s.url);
    if (contentSourceId && url) {
      source = {
        contentSourceId,
        userImportId: asString(s.userImportId),
        kind: asKind(s.kind),
        label: asString(s.label) ?? 'Found from this page',
        url,
        title: asString(s.title),
        collectionId: asString(s.collectionId),
      };
    }
  }

  const specs: Record<string, string> = {};
  if (row.specifications && typeof row.specifications === 'object' && !Array.isArray(row.specifications)) {
    for (const [key, value] of Object.entries(row.specifications as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) specs[key] = value.trim();
    }
  }

  const gallery = Array.isArray(row.galleryImages)
    ? row.galleryImages.filter((item): item is string => typeof item === 'string' && item.startsWith('http'))
    : [];

  let reviews: ProductPageView['reviews'] = null;
  if (row.reviews && typeof row.reviews === 'object' && !Array.isArray(row.reviews)) {
    const r = row.reviews as Record<string, unknown>;
    const likes = Array.isArray(r.likes)
      ? r.likes.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [];
    const concerns = Array.isArray(r.concerns)
      ? r.concerns.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [];
    const sources: NonNullable<ProductPageView['reviews']>['sources'] = [];
    if (Array.isArray(r.sources)) {
      for (const item of r.sources) {
        if (!item || typeof item !== 'object') continue;
        const source = item as Record<string, unknown>;
        const name = asString(source.name);
        const url = asString(source.url);
        if (!name || !url || !url.startsWith('http')) continue;
        sources.push({ name, url });
      }
    }
    const overview = asString(r.overview);
    if (overview || likes.length || concerns.length) {
      const count = r.reviewCount;
      reviews = {
        overview,
        likes,
        concerns,
        sources,
        rating: asString(r.rating),
        reviewCount: typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : null,
      };
    }
  }

  return {
    productId,
    shoppingProductId: asString(row.shoppingProductId),
    title,
    brand: asString(row.brand),
    category: asString(row.category),
    heroImage: asString(row.heroImage),
    galleryImages: gallery,
    price: asString(row.price),
    currency: asString(row.currency),
    merchant: asString(row.merchant),
    description: asString(row.description),
    specifications: specs,
    offers,
    canShop: row.canShop === true,
    source,
    relatedMedia,
    reviews,
    compareAvailable: row.compareAvailable === true,
    detailsUpdating: row.detailsUpdating === true,
  };
}
