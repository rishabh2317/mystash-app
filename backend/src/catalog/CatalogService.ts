import { LocalCatalogSearch } from '../product-intelligence/catalog/LocalCatalogSearch';
import type { CatalogRepository, LocalSearchHit } from '../product-intelligence/interfaces/CatalogRepository';
import type {
  CatalogProduct,
  CreateCatalogInput,
  NormalizedProduct,
  UpdateCatalogInput,
  VerificationStatus,
} from '../product-intelligence/domain/types';
import { buildCatalogEventPayload } from './domain/events';
import {
  assertCatalogStatusTransition,
  statusAfterLifecycleAction,
} from './domain/lifecycle';
import type {
  LifecycleAction,
  ShoppingProjection,
  UnresolvedPlaceholderInput,
} from './domain/types';
import { emitCatalogEvent } from './observability';
import { noopCollectionTagRemap, type CollectionTagRemapPort } from './ports';
import {
  scheduleSearchCatalogProduct,
  scheduleSearchCatalogProductRemoved,
} from '../search/schedule';

export class CatalogServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'CatalogServiceError';
  }
}

const VERIFICATION_RANK: Record<VerificationStatus, number> = {
  VERIFIED: 2,
  UNVERIFIED: 1,
  UNRESOLVED: 0,
};

/**
 * Catalog application boundary (Lookup Port + write capabilities + merge).
 * Other domains must depend on this service, not repository internals.
 */
export class CatalogService {
  private readonly local: LocalCatalogSearch;

  constructor(
    private readonly repo: CatalogRepository,
    private readonly tagRemap: CollectionTagRemapPort = noopCollectionTagRemap,
  ) {
    this.local = new LocalCatalogSearch(repo);
  }

  /** Expose underlying repo only for PI LocalCatalogSearch DI during transitional wiring. */
  asRepository(): CatalogRepository {
    return this.repo;
  }

  // —— Lookup Port ——

  async getById(id: string): Promise<CatalogProduct | null> {
    return this.repo.findById(id);
  }

  async getBySlug(slug: string): Promise<CatalogProduct | null> {
    return this.repo.findBySlug(slug);
  }

  /**
   * Follow MERGED tombstones to the survivor (or terminal non-merged / missing).
   */
  async resolveActiveProduct(id: string): Promise<CatalogProduct | null> {
    const seen = new Set<string>();
    let currentId: string | null = id;
    while (currentId) {
      if (seen.has(currentId)) {
        throw new CatalogServiceError('Catalog merge cycle detected', 500);
      }
      seen.add(currentId);
      const product = await this.repo.findById(currentId);
      if (!product) return null;
      if (product.status !== 'MERGED' || !product.mergedIntoId) {
        return product;
      }
      currentId = product.mergedIntoId;
    }
    return null;
  }

  async findByAlias(alias: string): Promise<CatalogProduct[]> {
    return this.repo.findByAlias(alias);
  }

  async findByNormalizedName(normalizedName: string): Promise<CatalogProduct[]> {
    return this.repo.findByNormalizedName(normalizedName);
  }

  async findByBrandModel(brand: string, model: string): Promise<CatalogProduct[]> {
    return this.repo.findByBrandModel(brand, model);
  }

  async findByMerchantUrl(merchantUrl: string): Promise<CatalogProduct | null> {
    return this.repo.findByMerchantUrl(merchantUrl);
  }

  async localSearch(norm: NormalizedProduct): Promise<LocalSearchHit | null> {
    return this.local.search(norm);
  }

  async listPublicActive(limit = 100): Promise<CatalogProduct[]> {
    const pool = await this.repo.listActiveForFuzzy(limit);
    return pool.filter((p) => p.status === 'ACTIVE');
  }

  // —— Write capabilities ——

  async createFromResolve(input: CreateCatalogInput): Promise<CatalogProduct> {
    const product = await this.repo.create({
      ...input,
      preferredShoppingUrl: input.preferredShoppingUrl ?? input.merchantUrl ?? null,
      shoppingProvider:
        input.shoppingProvider ??
        (input.preferredShoppingUrl || input.merchantUrl ? 'merchant' : null),
    });
    emitCatalogEvent(
      'ProductCreated',
      buildCatalogEventPayload({
        catalogProductId: product.id,
        slug: product.canonicalSlug,
        verificationStatus: product.verificationStatus,
        source: product.verificationSource ?? undefined,
      }),
    );
    if (product.verificationStatus === 'VERIFIED') {
      emitCatalogEvent(
        'ProductVerified',
        buildCatalogEventPayload({
          catalogProductId: product.id,
          verificationStatus: 'VERIFIED',
          provider: product.verificationProvider ?? undefined,
          version: product.verificationVersion ?? undefined,
          confidence: product.verificationConfidence,
        }),
      );
    }
    scheduleSearchCatalogProduct(product);
    return product;
  }

  /**
   * Background / re-resolve: update in place when id exists; otherwise create.
   */
  async createOrUpdateFromResolve(
    existingId: string | null | undefined,
    input: CreateCatalogInput,
  ): Promise<CatalogProduct> {
    if (existingId) {
      const existing = await this.repo.findById(existingId);
      if (existing) {
        const prevVerification = existing.verificationStatus;
        const updated = await this.repo.update(existingId, {
          name: input.name,
          brand: input.brand ?? existing.brand,
          model: input.model ?? existing.model,
          category: input.category ?? existing.category,
          description: input.description ?? existing.description,
          imageUrl: input.imageUrl ?? existing.imageUrl,
          merchant: input.merchant ?? existing.merchant,
          merchantUrl: input.merchantUrl ?? existing.merchantUrl,
          preferredShoppingUrl:
            input.preferredShoppingUrl !== undefined
              ? input.preferredShoppingUrl
              : existing.preferredShoppingUrl,
          shoppingProvider:
            input.shoppingProvider !== undefined
              ? input.shoppingProvider
              : existing.shoppingProvider,
          price: input.price ?? existing.price,
          currency:
            input.price != null
              ? input.currency ?? null
              : input.currency ?? existing.currency,
          verificationStatus: input.verificationStatus,
          verificationProvider: input.verificationProvider ?? input.verificationSource,
          verificationSource: input.verificationSource,
          verificationVersion: input.verificationVersion,
          aiConfidence: input.aiConfidence,
          matchConfidence: input.matchConfidence,
          verificationConfidence: input.verificationConfidence,
          metadata: input.metadata,
        });
        this.emitUpdateAndVerification(prevVerification, updated, [
          'name',
          'verification',
          'metadata',
        ]);
        for (const a of input.aliases ?? []) {
          await this.addAlias(updated.id, a);
        }
        scheduleSearchCatalogProduct(updated);
        return updated;
      }
    }
    return this.createFromResolve(input);
  }

  async addAlias(catalogProductId: string, alias: string): Promise<void> {
    const product = await this.repo.findById(catalogProductId);
    if (!product) throw new CatalogServiceError('Catalog product not found', 404);
    await this.repo.addAlias(catalogProductId, alias);
    emitCatalogEvent(
      'AliasAdded',
      buildCatalogEventPayload({
        catalogProductId,
        alias: alias.toLowerCase().trim(),
      }),
    );
  }

  async setVerification(
    id: string,
    verificationStatus: VerificationStatus,
    opts: {
      provider?: string | null;
      source?: string | null;
      version?: string | null;
      confidence?: number | null;
    } = {},
  ): Promise<CatalogProduct> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new CatalogServiceError('Catalog product not found', 404);
    const updated = await this.repo.update(id, {
      verificationStatus,
      verificationProvider: opts.provider ?? existing.verificationProvider,
      verificationSource: opts.source ?? existing.verificationSource,
      verificationVersion: opts.version ?? existing.verificationVersion,
      verificationConfidence: opts.confidence ?? existing.verificationConfidence,
      lastVerifiedAt:
        verificationStatus === 'VERIFIED' ? new Date().toISOString() : existing.lastVerifiedAt,
    });
    this.emitUpdateAndVerification(existing.verificationStatus, updated, ['verification']);
    scheduleSearchCatalogProduct(updated);
    return updated;
  }

  async applyLifecycle(id: string, action: LifecycleAction): Promise<CatalogProduct> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new CatalogServiceError('Catalog product not found', 404);
    const next = statusAfterLifecycleAction(existing.status, action);
    assertCatalogStatusTransition(existing.status, next);
    const updated = await this.repo.update(id, { status: next });
    emitCatalogEvent(
      'LifecycleChanged',
      buildCatalogEventPayload({
        catalogProductId: id,
        from: existing.status,
        to: next,
      }),
    );
    scheduleSearchCatalogProduct(updated);
    return updated;
  }

  async ensureUnresolvedPlaceholder(
    input: UnresolvedPlaceholderInput,
  ): Promise<CatalogProduct> {
    const normalized =
      input.normalizedName?.trim() ||
      input.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const slug = `publish-${input.draftId}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return this.createFromResolve({
      canonicalSlug: slug,
      name: input.name,
      normalizedName: normalized,
      brand: null,
      model: null,
      category: null,
      imageUrl: input.imageUrl ?? null,
      merchantUrl: input.merchantUrl ?? null,
      preferredShoppingUrl: input.merchantUrl ?? null,
      shoppingProvider: input.merchantUrl ? 'merchant' : null,
      price: input.price ?? null,
      verificationStatus: 'UNRESOLVED',
      verificationSource: 'publish_placeholder',
      verificationVersion: 'v1',
      metadata: { source: 'publish_ensure_catalog' },
    });
  }

  async applyShoppingProjection(
    id: string,
    projection: ShoppingProjection,
  ): Promise<CatalogProduct> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new CatalogServiceError('Catalog product not found', 404);
    const patch: UpdateCatalogInput = {};
    if (projection.preferredShoppingUrl !== undefined) {
      patch.preferredShoppingUrl = projection.preferredShoppingUrl;
    }
    if (projection.shoppingProvider !== undefined) {
      patch.shoppingProvider = projection.shoppingProvider;
    }
    if (projection.affiliateUrl !== undefined) {
      patch.affiliateUrl = projection.affiliateUrl;
    }
    if (projection.price !== undefined) patch.price = projection.price;
    if (projection.currency !== undefined) patch.currency = projection.currency;
    // Does not touch merchantUrl (verification provenance).
    const updated = await this.repo.update(id, patch);
    emitCatalogEvent(
      'ShoppingProjectionUpdated',
      buildCatalogEventPayload({ catalogProductId: id }),
    );
    return updated;
  }

  /**
   * Merge source → target (survivor). Implements ProductMergeService contract.
   */
  async merge(sourceId: string, targetId: string): Promise<CatalogProduct> {
    if (sourceId === targetId) {
      throw new CatalogServiceError('Cannot merge a Catalog product into itself', 400);
    }
    const source = await this.repo.findById(sourceId);
    const target = await this.repo.findById(targetId);
    if (!source || !target) {
      throw new CatalogServiceError('Catalog product not found for merge', 404);
    }
    if (source.status === 'MERGED' && source.mergedIntoId === targetId) {
      return this.resolveActiveProduct(targetId).then((p) => {
        if (!p) throw new CatalogServiceError('Survivor missing after merge', 500);
        return p;
      });
    }
    if (source.status === 'MERGED') {
      throw new CatalogServiceError('Source Catalog product is already MERGED', 400);
    }
    if (target.status === 'MERGED') {
      throw new CatalogServiceError('Cannot merge into a MERGED Catalog product', 400);
    }

    // Cycle guard: target must not already resolve into source.
    const survivorOfTarget = await this.resolveActiveProduct(targetId);
    if (survivorOfTarget && survivorOfTarget.id === sourceId) {
      throw new CatalogServiceError('Merge would create a cycle', 400);
    }

    const patch = this.survivorshipPatch(source, target);
    const survivor = await this.repo.update(targetId, patch);

    // Alias migration
    const sourceAliases =
      (await this.repo.listAliases?.(sourceId)) ?? [];
    for (const a of sourceAliases) {
      await this.repo.addAlias(targetId, a);
    }
    await this.repo.addAlias(targetId, source.normalizedName);
    await this.repo.addAlias(targetId, source.name);
    await this.repo.addAlias(targetId, source.canonicalSlug);

    assertCatalogStatusTransition(source.status, 'MERGED');
    await this.repo.update(sourceId, {
      status: 'MERGED',
      mergedIntoId: targetId,
    });
    emitCatalogEvent(
      'LifecycleChanged',
      buildCatalogEventPayload({
        catalogProductId: sourceId,
        from: source.status,
        to: 'MERGED',
      }),
    );
    emitCatalogEvent(
      'ProductMerged',
      buildCatalogEventPayload({
        catalogProductId: targetId,
        sourceId,
        targetId,
        survivorId: targetId,
      }),
    );

    await this.tagRemap.remapCatalogProduct(sourceId, targetId);
    scheduleSearchCatalogProductRemoved(sourceId);
    scheduleSearchCatalogProduct(survivor);
    return survivor;
  }

  private survivorshipPatch(
    source: CatalogProduct,
    target: CatalogProduct,
  ): UpdateCatalogInput {
    const preferSourceIdentity =
      VERIFICATION_RANK[source.verificationStatus] >
      VERIFICATION_RANK[target.verificationStatus];

    const patch: UpdateCatalogInput = {
      brand: target.brand ?? source.brand,
      model: target.model ?? source.model,
      category: target.category ?? source.category,
      description: target.description ?? source.description,
      imageUrl: target.imageUrl ?? source.imageUrl,
      merchant: target.merchant ?? source.merchant,
      merchantUrl: target.merchantUrl ?? source.merchantUrl,
      preferredShoppingUrl: target.preferredShoppingUrl ?? source.preferredShoppingUrl,
      shoppingProvider: target.shoppingProvider ?? source.shoppingProvider,
      affiliateUrl: target.affiliateUrl ?? source.affiliateUrl,
      price: target.price ?? source.price,
      currency: target.currency ?? source.currency,
      metadata: { ...source.metadata, ...target.metadata },
    };

    if (preferSourceIdentity) {
      patch.name = source.name;
      patch.brand = source.brand ?? target.brand;
      patch.model = source.model ?? target.model;
      patch.verificationStatus = source.verificationStatus;
      patch.verificationProvider = source.verificationProvider;
      patch.verificationSource = source.verificationSource;
      patch.verificationVersion = source.verificationVersion;
      patch.verificationConfidence = source.verificationConfidence;
      patch.lastVerifiedAt = source.lastVerifiedAt;
    } else if (
      VERIFICATION_RANK[source.verificationStatus] ===
        VERIFICATION_RANK[target.verificationStatus] &&
      !target.imageUrl &&
      source.imageUrl
    ) {
      patch.imageUrl = source.imageUrl;
    }

    return patch;
  }

  private emitUpdateAndVerification(
    prev: VerificationStatus,
    updated: CatalogProduct,
    changedFields: string[],
  ): void {
    emitCatalogEvent(
      'CatalogUpdated',
      buildCatalogEventPayload({
        catalogProductId: updated.id,
        changedFields,
        verificationStatus: updated.verificationStatus,
      }),
    );
    if (prev !== 'VERIFIED' && updated.verificationStatus === 'VERIFIED') {
      emitCatalogEvent(
        'ProductVerified',
        buildCatalogEventPayload({
          catalogProductId: updated.id,
          verificationStatus: 'VERIFIED',
          provider: updated.verificationProvider ?? undefined,
          version: updated.verificationVersion ?? undefined,
          confidence: updated.verificationConfidence,
        }),
      );
    } else if (prev === 'VERIFIED' && updated.verificationStatus !== 'VERIFIED') {
      emitCatalogEvent(
        'ProductUnverified',
        buildCatalogEventPayload({
          catalogProductId: updated.id,
          verificationStatus: updated.verificationStatus,
          reason: 'verification_downgraded',
        }),
      );
    }
  }
}
