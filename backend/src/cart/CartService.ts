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
import { mapCatalogToCartProjection, type CatalogCartPort } from './ports';

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
  ) {}

  async getCart(userId: string): Promise<CartView> {
    if (!userId) throw new CartServiceError('userId required', 401);
    const rows = await this.repo.listByUser(userId);
    const items = await Promise.all(rows.map((row) => this.toItemView(row)));
    return { items, itemCount: items.length };
  }

  async addItem(userId: string, input: AddCartItemInput): Promise<AddCartItemResult> {
    if (!userId) throw new CartServiceError('userId required', 401);
    const catalogProductId = normalizeCatalogProductId(input.catalogProductId);
    if (!catalogProductId) {
      throw new CartServiceError('Invalid catalogProductId', 400);
    }

    const resolved = await this.catalog.resolveActiveProduct(catalogProductId);
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
        sourceCollectionId: source?.sourceCollectionId ?? null,
        sourceCreatorId: source?.sourceCreatorId ?? null,
        sourceCollectionProductTagId: source?.sourceCollectionProductTagId ?? null,
        sourceSurface: source?.sourceSurface ?? null,
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
    }

    return { removed, catalogProductId };
  }

  async remapAfterCatalogMerge(
    sourceId: string,
    targetId: string,
  ): Promise<{ remapped: number; collisionsResolved: number }> {
    return this.repo.remapCatalogProduct(sourceId, targetId);
  }

  private async toItemView(row: CartItemRecord): Promise<CartItemView> {
    const resolved = await this.catalog.resolveActiveProduct(row.catalogProductId);
    const availability = this.deriveAvailability(resolved);
    const product = resolved ? mapCatalogToCartProjection(resolved) : null;
    return {
      cartItemId: row.id,
      // Prefer survivor id when resolve succeeds so FE Buy uses shopping identity.
      catalogProductId: resolved?.id ?? row.catalogProductId,
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
