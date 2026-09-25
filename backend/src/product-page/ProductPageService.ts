import type { CatalogProduct } from '../product-intelligence/domain/types';
import { resolvePersistableCategory } from '../product-intelligence/domain/categoryTaxonomy';
import type { DiscoveredProductRecord } from '../discovered/domain/types';
import {
  catalogShoppingSource,
  discoveredShoppingSource,
  listStoredShoppingDestinations,
} from '../shopping/storedDestinations';
import {
  extractGallery,
  extractSpecifications,
  mapContentSourceToPageSource,
} from './domain/map';
import {
  contentSourceToRelatedMedia,
  finalizeRelatedMedia,
  isUsableMediaUrl,
  mediaIdentityKey,
} from './domain/media';
import { pageLevelPrice, projectPageOffers } from './domain/offers';
import { detailsUpdatingFromMetadata } from './domain/detailsUpdating';
import type {
  ProductPageQuery,
  ProductPageRelatedMedia,
  ProductPageSource,
  ProductPageView,
} from './domain/types';
import {
  emptyReviewPort,
  type ProductPageCatalogPort,
  type ProductPageContentSourcePort,
  type ProductPageDiscoveredPort,
  type ProductPageRelatedMediaPort,
  type ProductPageReviewPort,
  type ProductPageShopPort,
} from './ports';

export class ProductPageServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'ProductPageServiceError';
  }
}

const RELATED_MEDIA_LIMIT = 6;

/**
 * Read-only Product Page projection. Never writes catalog_products.
 */
export class ProductPageService {
  constructor(
    private readonly catalog: ProductPageCatalogPort,
    private readonly discovered: ProductPageDiscoveredPort,
    private readonly contentSources: ProductPageContentSourcePort,
    private readonly shop: ProductPageShopPort,
    private readonly relatedMedia: ProductPageRelatedMediaPort,
    private readonly reviews: ProductPageReviewPort = emptyReviewPort,
  ) {}

  async getPage(productId: string, query: ProductPageQuery = {}): Promise<ProductPageView> {
    const id = productId.trim();
    if (!id) throw new ProductPageServiceError('Product id is required', 400);

    const catalogProduct = await this.catalog.resolveActiveProduct(id);
    if (catalogProduct && catalogProduct.status !== 'HIDDEN') {
      return this.fromCatalog(catalogProduct, query);
    }

    const discoveredProduct = await this.discovered.getById(id);
    if (discoveredProduct && discoveredProduct.internalStatus === 'ACTIVE') {
      return this.fromDiscovered(discoveredProduct, query);
    }

    throw new ProductPageServiceError('Product not found', 404);
  }

  private async fromCatalog(
    product: CatalogProduct,
    query: ProductPageQuery,
  ): Promise<ProductPageView> {
    const offers = projectPageOffers(listStoredShoppingDestinations(catalogShoppingSource(product)), 'buy');
    const canShop = offers.some((offer) => offer.action !== 'none') || this.shop.canShopCatalog(product);
    const listed = pageLevelPrice(offers, { price: product.price, currency: product.currency });
    const { source, relatedMedia } = await this.resolveMedia({
      catalogProductId: product.id,
      discoveredProductId: null,
      query,
    });
    const reviews = await this.reviews.findReady(product.id).catch(() => null);

    return {
      productId: product.id,
      shoppingProductId: product.id,
      title: product.name,
      brand: product.brand,
      category: resolvePersistableCategory(product.category) ?? product.category ?? null,
      heroImage: product.imageUrl,
      galleryImages: extractGallery(product.metadata, product.imageUrl),
      price: listed.price,
      currency: listed.currency,
      merchant: product.merchant,
      description: product.description,
      specifications: extractSpecifications(product.metadata),
      offers,
      canShop,
      source,
      relatedMedia,
      reviews,
      compareAvailable: true,
      detailsUpdating: false,
    };
  }

  private async fromDiscovered(
    product: DiscoveredProductRecord,
    query: ProductPageQuery,
  ): Promise<ProductPageView> {
    const offers = projectPageOffers(
      listStoredShoppingDestinations(discoveredShoppingSource(product)),
      'listing',
    );
    const listed = pageLevelPrice(offers, { price: product.price, currency: product.currency });
    const { source, relatedMedia } = await this.resolveMedia({
      catalogProductId: product.catalogProductId,
      discoveredProductId: product.id,
      query,
    });
    const reviews = product.catalogProductId
      ? await this.reviews.findReady(product.catalogProductId).catch(() => null)
      : null;

    return {
      productId: product.id,
      // Catalogue id when linked — ShoppingResolver + AI review. Listing-only stays null.
      shoppingProductId: product.catalogProductId,
      title: product.name,
      brand: product.brand,
      category: resolvePersistableCategory(product.category) ?? product.category,
      heroImage: product.imageUrl,
      galleryImages: product.imageUrl ? [product.imageUrl] : [],
      price: listed.price,
      currency: listed.currency,
      merchant: product.merchant,
      description: null,
      specifications: extractSpecifications(product.metadata),
      offers,
      canShop: offers.some((offer) => offer.action !== 'none'),
      source,
      relatedMedia,
      reviews,
      compareAvailable: true,
      detailsUpdating: detailsUpdatingFromMetadata(product.metadata),
    };
  }

  private async resolveMedia(input: {
    catalogProductId: string | null;
    discoveredProductId: string | null;
    query: ProductPageQuery;
  }): Promise<{ source: ProductPageSource | null; relatedMedia: ProductPageRelatedMedia[] }> {
    const userImportId = input.query.userImportId ?? null;
    const boundIds = await this.contentSources.listBoundSourceIds({
      catalogProductId: input.catalogProductId,
      discoveredProductId: input.discoveredProductId,
    });

    let source: ProductPageSource | null = null;
    const preferred = input.query.contentSourceId?.trim();
    if (preferred) {
      const record = await this.contentSources.getById(preferred);
      if (record && isUsableMediaUrl(record.canonicalUrl)) {
        source = mapContentSourceToPageSource(record, userImportId);
      }
    }
    if (!source) {
      for (const id of boundIds) {
        const record = await this.contentSources.getById(id);
        if (record && isUsableMediaUrl(record.canonicalUrl)) {
          source = mapContentSourceToPageSource(record, userImportId);
          break;
        }
      }
    }

    const gathered: ProductPageRelatedMedia[] = [];
    if (source) {
      try {
        gathered.push(...(await this.relatedMedia.listMatchingUrls([source.url], 1)));
      } catch {
        /* collection match for discovery is optional */
      }
    }
    if (input.catalogProductId) {
      try {
        gathered.push(
          ...(await this.relatedMedia.listForCatalogProduct(input.catalogProductId, RELATED_MEDIA_LIMIT)),
        );
      } catch {
        /* published collection media is optional */
      }
    }

    const otherSources = [];
    for (const id of boundIds) {
      if (id === source?.contentSourceId) continue;
      const record = await this.contentSources.getById(id);
      if (!record || !isUsableMediaUrl(record.canonicalUrl)) continue;
      otherSources.push(record);
    }
    if (otherSources.length > 0) {
      try {
        gathered.push(
          ...(await this.relatedMedia.listMatchingUrls(
            otherSources.map((row) => row.canonicalUrl),
            RELATED_MEDIA_LIMIT,
          )),
        );
      } catch {
        /* collection URL matches are optional */
      }
      for (const record of otherSources) {
        const mapped = contentSourceToRelatedMedia(record);
        if (mapped) gathered.push(mapped);
      }
    }

    // Prefer in-app reel playback when discovery is already a published collection.
    if (source && !source.collectionId) {
      const sourceKey = mediaIdentityKey(source.url);
      const match = gathered.find(
        (item) =>
          Boolean(item.collectionId) &&
          (item.url === source!.url ||
            (Boolean(sourceKey) && mediaIdentityKey(item.url) === sourceKey)),
      );
      if (match?.collectionId) {
        source = {
          ...source,
          collectionId: match.collectionId,
          title: source.title ?? match.title,
        };
      }
    }

    return { source, relatedMedia: finalizeRelatedMedia(gathered, source, RELATED_MEDIA_LIMIT) };
  }
}
