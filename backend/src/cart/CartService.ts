import type { CatalogProduct } from '../product-intelligence/domain/types';
import type { CartRepository } from './CartRepository';
import { buildCartEventPayload } from './domain/events';
import {
  hasShoppingDestinationHint,
  isCartableStatus,
  normalizeCartSource,
  normalizeCatalogProductId,
  sourceFromRecord,
} from './domain/lifecycle';
import type {
  AddCartItemInput,
  AddCartItemResult,
  CartItemAvailability,
  CartItemRecord,
  CartItemView,
  CartView,
  RemoveCartItemReason,
} from './domain/types';
import { emitCartEvent } from './observability';
import {
  mapCatalogToCartProjection,
  mapDiscoveredToCartProjection,
  type CatalogCartPort,
  type DiscoveredCartPort,
} from './ports';

export class CartServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'CartServiceError';
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return e.code === '23505' || Boolean(e.message?.toLowerCase().includes('duplicate'));
}

/**
 * Cart application boundary — authenticated membership SoT.
 */
export class CartService {
  constructor(
    private readonly repo: CartRepository,
    private readonly catalog: CatalogCartPort,
    private readonly discovered: DiscoveredCartPort | null = null,
  ) {}

  async getCart(userId: string): Promise<CartView> {
    if (!userId) throw new CartServiceError('userId required', 401);
    const rows = await this.repo.listByUser(userId);
    const items = await Promise.all(rows.map((row) => this.toItemView(row)));
    return { items, itemCount: items.length };
  }

  async addItem(userId: string, input: AddCartItemInput): Promise<AddCartItemResult> {
    if (!userId) throw new CartServiceError('userId required', 401);
    const catalogProductId = input.catalogProductId
      ? normalizeCatalogProductId(input.catalogProductId)
      : null;
    const discoveredProductId = input.discoveredProductId
      ? normalizeCatalogProductId(input.discoveredProductId)
      : null;

    if (catalogProductId && discoveredProductId) {
      throw new CartServiceError('Provide exactly one of catalogProductId or discoveredProductId', 400);
    }
    if (!catalogProductId && !discoveredProductId) {
      throw new CartServiceError('Invalid catalogProductId', 400);
    }

    if (discoveredProductId) {
      return this.addDiscoveredItem(userId, discoveredProductId, input);
    }

    const resolved = await this.catalog.resolveActiveProduct(catalogProductId!);
    if (!resolved) {
      throw new CartServiceError('Product not found', 404);
    }
    if (!isCartableStatus(resolved.status)) {
      throw new CartServiceError('Product is not available to add to cart', 404);
    }

    const survivorId = resolved.id;
    const existing = await this.repo.findByUserAndProduct(userId, survivorId);
    if (existing) {
      emitCartEvent(
        'CartItemAdded',
        buildCartEventPayload({
          userId,
          catalogProductId: survivorId,
          cartItemId: existing.id,
          created: false,
          source: sourceFromRecord(existing),
        }),
      );
      return { item: existing, created: false };
    }

    const source = normalizeCartSource(input.source);
    try {
      const item = await this.repo.insert({
        userId,
        catalogProductId: survivorId,
        discoveredProductId: null,
        sourceCollectionId: source?.sourceCollectionId ?? null,
        sourceCreatorId: source?.sourceCreatorId ?? null,
        sourceCollectionProductTagId: source?.sourceCollectionProductTagId ?? null,
        sourceSurface: source?.sourceSurface ?? null,
        sourceContentSourceId: source?.sourceContentSourceId ?? null,
        sourceUserImportId: source?.sourceUserImportId ?? null,
      });
      emitCartEvent(
        'CartItemAdded',
        buildCartEventPayload({
          userId,
          catalogProductId: survivorId,
          cartItemId: item.id,
          created: true,
          source: sourceFromRecord(item),
        }),
      );
      return { item, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.repo.findByUserAndProduct(userId, survivorId);
      if (!raced) throw err;
      emitCartEvent(
        'CartItemAdded',
        buildCartEventPayload({
          userId,
          catalogProductId: survivorId,
          cartItemId: raced.id,
          created: false,
          source: sourceFromRecord(raced),
        }),
      );
      return { item: raced, created: false };
    }
  }

  async removeItem(
    userId: string,
    catalogProductIdRaw: string,
    reason: RemoveCartItemReason = 'user_remove',
  ): Promise<{ removed: boolean; catalogProductId: string }> {
    if (!userId) throw new CartServiceError('userId required', 401);
    const catalogProductId = normalizeCatalogProductId(catalogProductIdRaw);
    if (!catalogProductId) {
      throw new CartServiceError('Invalid catalogProductId', 400);
    }

    const before =
      (await this.repo.findByUserAndProduct(userId, catalogProductId)) ?? null;

    let removed = await this.repo.deleteByUserAndProduct(userId, catalogProductId);

    // Also try survivor id if the client sent a MERGED tombstone id.
    const resolved = await this.catalog.resolveActiveProduct(catalogProductId);
    if (resolved && resolved.id !== catalogProductId) {
      const survivorBefore = await this.repo.findByUserAndProduct(userId, resolved.id);
      const survivorRemoved = await this.repo.deleteByUserAndProduct(userId, resolved.id);
      if (survivorRemoved) {
        removed = true;
        emitCartEvent(
          'CartItemRemoved',
          buildCartEventPayload({
            userId,
            catalogProductId: resolved.id,
            cartItemId: survivorBefore?.id ?? before?.id ?? null,
            reason,
            source: survivorBefore ? sourceFromRecord(survivorBefore) : null,
          }),
        );
        return { removed: true, catalogProductId: resolved.id };
      }
    }

    if (removed) {
      emitCartEvent(
        'CartItemRemoved',
        buildCartEventPayload({
          userId,
          catalogProductId,
          cartItemId: before?.id ?? null,
          reason,
          source: before ? sourceFromRecord(before) : null,
        }),
      );
      return { removed: true, catalogProductId };
    }

    const discoveredBefore = await this.repo.findByUserAndDiscovered(userId, catalogProductId);
    const discoveredRemoved = await this.repo.deleteByUserAndDiscovered(userId, catalogProductId);
    if (discoveredRemoved) {
      emitCartEvent(
        'CartItemRemoved',
        buildCartEventPayload({
          userId,
          catalogProductId: '',
          cartItemId: discoveredBefore?.id ?? null,
          reason,
          source: discoveredBefore ? sourceFromRecord(discoveredBefore) : null,
        }),
      );
      return { removed: true, catalogProductId };
    }

    return { removed: false, catalogProductId };
  }

  private async addDiscoveredItem(
    userId: string,
    discoveredProductId: string,
    input: AddCartItemInput,
  ): Promise<AddCartItemResult> {
    if (!this.discovered) {
      throw new CartServiceError('Product not found', 404);
    }
    const product = await this.discovered.getById(discoveredProductId);
    if (!product || product.internalStatus !== 'ACTIVE') {
      throw new CartServiceError('Product not found', 404);
    }

    const existing = await this.repo.findByUserAndDiscovered(userId, discoveredProductId);
    if (existing) {
      emitCartEvent(
        'CartItemAdded',
        buildCartEventPayload({
          userId,
          catalogProductId: existing.catalogProductId ?? '',
          cartItemId: existing.id,
          created: false,
          source: sourceFromRecord(existing),
        }),
      );
      return { item: existing, created: false };
    }

    const source = normalizeCartSource(input.source);
    try {
      const item = await this.repo.insert({
        userId,
        catalogProductId: null,
        discoveredProductId,
        sourceCollectionId: source?.sourceCollectionId ?? null,
        sourceCreatorId: source?.sourceCreatorId ?? null,
        sourceCollectionProductTagId: source?.sourceCollectionProductTagId ?? null,
        sourceSurface: source?.sourceSurface ?? null,
        sourceContentSourceId: source?.sourceContentSourceId ?? null,
        sourceUserImportId: source?.sourceUserImportId ?? null,
      });
      emitCartEvent(
        'CartItemAdded',
        buildCartEventPayload({
          userId,
          catalogProductId: '',
          cartItemId: item.id,
          created: true,
          source: sourceFromRecord(item),
        }),
      );
      return { item, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.repo.findByUserAndDiscovered(userId, discoveredProductId);
      if (!raced) throw err;
      emitCartEvent(
        'CartItemAdded',
        buildCartEventPayload({
          userId,
          catalogProductId: '',
          cartItemId: raced.id,
          created: false,
          source: sourceFromRecord(raced),
        }),
      );
      return { item: raced, created: false };
    }
  }

  async remapAfterCatalogMerge(
    sourceId: string,
    targetId: string,
  ): Promise<{ remapped: number; collisionsResolved: number }> {
    return this.repo.remapCatalogProduct(sourceId, targetId);
  }

  private async toItemView(row: CartItemRecord): Promise<CartItemView> {
    if (row.discoveredProductId) {
      const discovered = this.discovered
        ? await this.discovered.getById(row.discoveredProductId)
        : null;
      return {
        cartItemId: row.id,
        catalogProductId: null,
        discoveredProductId: row.discoveredProductId,
        addedAt: row.addedAt,
        source: sourceFromRecord(row),
        availability: discovered?.merchantUrl ? 'AVAILABLE' : 'NO_DESTINATION',
        product: discovered ? mapDiscoveredToCartProjection(discovered) : null,
      };
    }

    const resolved = row.catalogProductId
      ? await this.catalog.resolveActiveProduct(row.catalogProductId)
      : null;
    const availability = this.deriveAvailability(resolved);
    const product = resolved ? mapCatalogToCartProjection(resolved) : null;
    return {
      cartItemId: row.id,
      catalogProductId: resolved?.id ?? row.catalogProductId,
      discoveredProductId: null,
      addedAt: row.addedAt,
      source: sourceFromRecord(row),
      availability,
      product,
    };
  }

  private deriveAvailability(product: CatalogProduct | null): CartItemAvailability {
    if (!product) return 'UNAVAILABLE';
    if (product.status === 'HIDDEN' || product.status === 'DISCONTINUED') {
      return 'UNAVAILABLE';
    }
    if (product.status !== 'ACTIVE') return 'UNAVAILABLE';
    if (!hasShoppingDestinationHint(product)) return 'NO_DESTINATION';
    return 'AVAILABLE';
  }
}
