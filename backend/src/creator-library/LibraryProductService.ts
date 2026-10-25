import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentSourceRepository } from '../content-source/ContentSourceRepository';
import type { ContentSourceProductRecord } from '../content-source/domain/types';
import { SupabaseContentSourceRepository } from '../content-source/SupabaseContentSourceRepository';
import { SupabaseCatalogRepository } from '../product-intelligence/catalog/SupabaseCatalogRepository';
import { SupabaseDiscoveredProductRepository } from '../discovered/SupabaseDiscoveredProductRepository';
import type { CreatorLibraryRepository } from './CreatorLibraryRepository';
import { SupabaseCreatorLibraryRepository } from './SupabaseCreatorLibraryRepository';

export type AttachableProductSnapshot = {
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  price: string | null;
  currency: string | null;
  image: string | null;
  merchantUrl: string | null;
};

export type ProductIdentityLookup = {
  findCatalog(id: string): Promise<AttachableProductSnapshot | null>;
  findDiscovered(id: string): Promise<AttachableProductSnapshot | null>;
};

export class LibraryProductServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'LibraryProductServiceError';
  }
}

export function attachmentExternalId(kind: 'catalog' | 'discovered', id: string): string {
  return `${kind}:${id}`;
}

export class LibraryProductService {
  constructor(
    private readonly library: CreatorLibraryRepository,
    private readonly sources: ContentSourceRepository,
    private readonly products: ProductIdentityLookup,
  ) {}

  private async assertOwner(userId: string, contentSourceId: string): Promise<void> {
    const owns = await this.library.userOwnsContentSource(userId, contentSourceId);
    if (!owns) throw new LibraryProductServiceError('Library item not found', 404);
  }

  async list(userId: string, contentSourceId: string): Promise<ContentSourceProductRecord[]> {
    await this.assertOwner(userId, contentSourceId);
    return this.sources.listProducts(contentSourceId);
  }

  async attach(
    userId: string,
    contentSourceId: string,
    ref: { catalogProductId?: string; discoveredProductId?: string },
  ): Promise<{ product: ContentSourceProductRecord; created: boolean }> {
    await this.assertOwner(userId, contentSourceId);
    const catalogId = ref.catalogProductId?.trim() || null;
    const discoveredId = ref.discoveredProductId?.trim() || null;
    if (Boolean(catalogId) === Boolean(discoveredId)) {
      throw new LibraryProductServiceError('Provide a catalog or discovered product id', 400);
    }
    const kind = catalogId ? 'catalog' : 'discovered';
    const productId = (catalogId ?? discoveredId)!;
    const externalId = attachmentExternalId(kind, productId);
    const existing = await this.sources.findProductByExternalId(contentSourceId, externalId);
    if (existing) return { product: existing, created: false };

    const snapshot =
      kind === 'catalog'
        ? await this.products.findCatalog(productId)
        : await this.products.findDiscovered(productId);
    if (!snapshot) throw new LibraryProductServiceError('Product not found', 404);

    const current = await this.sources.listProducts(contentSourceId);
    const product = await this.sources.insertProduct({
      contentSourceId,
      position: current.length,
      externalId,
      name: snapshot.name,
      brand: snapshot.brand,
      model: snapshot.model,
      category: snapshot.category,
      price: snapshot.price,
      currency: snapshot.currency,
      image: snapshot.image,
      merchantUrl: snapshot.merchantUrl,
      confidence: null,
      extractionMethod: 'creator_manual',
      sources: ['creator_library'],
      evidence: { attachmentSource: 'CREATOR_MANUAL' },
      processorVersion: 'creator-library-attach',
      catalogProductId: catalogId,
      discoveredProductId: discoveredId,
      attachmentSource: 'CREATOR_MANUAL',
    });
    return { product, created: true };
  }

  async remove(userId: string, contentSourceId: string, productRowId: string): Promise<void> {
    await this.assertOwner(userId, contentSourceId);
    const rows = await this.sources.listProducts(contentSourceId);
    const row = rows.find((item) => item.id === productRowId);
    if (!row) throw new LibraryProductServiceError('Attachment not found', 404);
    if (
      row.attachmentSource !== 'CREATOR_MANUAL' &&
      row.attachmentSource !== 'CAMPAIGN' &&
      row.attachmentSource !== 'BRAND_FEED'
    ) {
      throw new LibraryProductServiceError('Only creator-attached products can be removed here', 400);
    }
    await this.sources.deleteProduct(contentSourceId, productRowId);
  }
}

export function createLibraryProductService(admin: SupabaseClient): LibraryProductService {
  const catalog = new SupabaseCatalogRepository(admin);
  const discovered = new SupabaseDiscoveredProductRepository(admin);
  return new LibraryProductService(
    new SupabaseCreatorLibraryRepository(admin),
    new SupabaseContentSourceRepository(admin),
    {
      findCatalog: async (id) => {
        const row = await catalog.findById(id);
        if (!row) return null;
        return {
          name: row.name,
          brand: row.brand,
          model: row.model,
          category: row.category,
          price: row.price,
          currency: row.currency,
          image: row.imageUrl,
          merchantUrl: row.merchantUrl,
        };
      },
      findDiscovered: async (id) => {
        const row = await discovered.findById(id);
        if (!row) return null;
        return {
          name: row.name,
          brand: row.brand,
          model: row.model,
          category: row.category,
          price: row.price,
          currency: row.currency,
          image: row.imageUrl,
          merchantUrl: row.merchantUrl,
        };
      },
    },
  );
}
