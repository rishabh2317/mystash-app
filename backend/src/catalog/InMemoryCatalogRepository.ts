import type {
  CatalogProduct,
  CreateCatalogInput,
  UpdateCatalogInput,
} from '../product-intelligence/domain/types';
import type { CatalogRepository } from '../product-intelligence/interfaces/CatalogRepository';
import { randomUUID } from 'node:crypto';

function clone(p: CatalogProduct): CatalogProduct {
  return { ...p, metadata: { ...p.metadata } };
}

/**
 * In-memory Catalog repository for unit tests.
 * Implements the same port as SupabaseCatalogRepository.
 */
export class InMemoryCatalogRepository implements CatalogRepository {
  private products = new Map<string, CatalogProduct>();
  private aliases = new Map<string, Set<string>>(); // productId → aliases

  seed(product: CatalogProduct, productAliases: string[] = []): void {
    this.products.set(product.id, clone(product));
    this.aliases.set(product.id, new Set(productAliases.map((a) => a.toLowerCase().trim()).filter(Boolean)));
  }

  all(): CatalogProduct[] {
    return [...this.products.values()].map(clone);
  }

  async findByNormalizedName(normalizedName: string): Promise<CatalogProduct[]> {
    const key = normalizedName.toLowerCase().trim();
    return [...this.products.values()]
      .filter((p) => p.normalizedName === key)
      .map(clone);
  }

  async findByAlias(alias: string): Promise<CatalogProduct[]> {
    const key = alias.toLowerCase().trim();
    const out: CatalogProduct[] = [];
    for (const [id, set] of this.aliases) {
      if (set.has(key)) {
        const p = this.products.get(id);
        if (p) out.push(clone(p));
      }
    }
    return out;
  }

  async findByBrandModel(brand: string, model: string): Promise<CatalogProduct[]> {
    const b = brand.toLowerCase();
    const m = model.toLowerCase();
    return [...this.products.values()]
      .filter(
        (p) =>
          (p.brand ?? '').toLowerCase() === b && (p.model ?? '').toLowerCase() === m,
      )
      .map(clone);
  }

  async findByMerchantUrl(merchantUrl: string): Promise<CatalogProduct | null> {
    const hit = [...this.products.values()].find((p) => p.merchantUrl === merchantUrl);
    return hit ? clone(hit) : null;
  }

  async findBySlug(slug: string): Promise<CatalogProduct | null> {
    const hit = [...this.products.values()].find((p) => p.canonicalSlug === slug);
    return hit ? clone(hit) : null;
  }

  async findById(id: string): Promise<CatalogProduct | null> {
    const p = this.products.get(id);
    return p ? clone(p) : null;
  }

  async create(input: CreateCatalogInput): Promise<CatalogProduct> {
    let slug = input.canonicalSlug;
    for (let i = 0; i < 5; i++) {
      if (!(await this.findBySlug(slug))) break;
      slug = `${input.canonicalSlug}-${i + 2}`;
    }
    const product: CatalogProduct = {
      id: randomUUID(),
      canonicalSlug: slug,
      brand: input.brand,
      name: input.name,
      normalizedName: input.normalizedName,
      model: input.model,
      category: input.category,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      merchant: input.merchant ?? null,
      merchantUrl: input.merchantUrl ?? null,
      preferredShoppingUrl: input.preferredShoppingUrl ?? input.merchantUrl ?? null,
      affiliateUrl: input.affiliateUrl ?? null,
      shoppingProvider:
        input.shoppingProvider ??
        (input.preferredShoppingUrl || input.merchantUrl ? 'merchant' : null),
      currency: input.currency ?? null,
      price: input.price ?? null,
      status: 'ACTIVE',
      verificationStatus: input.verificationStatus,
      verificationProvider: input.verificationProvider ?? input.verificationSource,
      verificationSource: input.verificationSource,
      verificationVersion: input.verificationVersion,
      lastVerifiedAt:
        input.verificationStatus === 'VERIFIED' ? new Date().toISOString() : null,
      aiConfidence: input.aiConfidence ?? null,
      matchConfidence: input.matchConfidence ?? null,
      verificationConfidence: input.verificationConfidence ?? null,
      mergedIntoId: null,
      metadata: input.metadata ?? {},
    };
    this.products.set(product.id, product);
    for (const a of input.aliases ?? []) {
      await this.addAlias(product.id, a);
    }
    return clone(product);
  }

  async update(id: string, patch: UpdateCatalogInput): Promise<CatalogProduct> {
    const existing = this.products.get(id);
    if (!existing) throw new Error(`catalog update: ${id} not found`);
    const next: CatalogProduct = {
      ...existing,
      name: patch.name !== undefined ? patch.name : existing.name,
      brand: patch.brand !== undefined ? patch.brand : existing.brand,
      model: patch.model !== undefined ? patch.model : existing.model,
      category: patch.category !== undefined ? patch.category : existing.category,
      description: patch.description !== undefined ? patch.description : existing.description,
      imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : existing.imageUrl,
      merchant: patch.merchant !== undefined ? patch.merchant : existing.merchant,
      merchantUrl: patch.merchantUrl !== undefined ? patch.merchantUrl : existing.merchantUrl,
      preferredShoppingUrl:
        patch.preferredShoppingUrl !== undefined
          ? patch.preferredShoppingUrl
          : existing.preferredShoppingUrl,
      affiliateUrl: patch.affiliateUrl !== undefined ? patch.affiliateUrl : existing.affiliateUrl,
      shoppingProvider:
        patch.shoppingProvider !== undefined
          ? patch.shoppingProvider
          : existing.shoppingProvider,
      currency: patch.currency !== undefined ? patch.currency : existing.currency,
      price: patch.price !== undefined ? patch.price : existing.price,
      status: patch.status !== undefined ? patch.status : existing.status,
      mergedIntoId:
        patch.mergedIntoId !== undefined ? patch.mergedIntoId : existing.mergedIntoId,
      verificationStatus:
        patch.verificationStatus !== undefined
          ? patch.verificationStatus
          : existing.verificationStatus,
      verificationProvider:
        patch.verificationProvider !== undefined
          ? patch.verificationProvider
          : existing.verificationProvider,
      verificationSource:
        patch.verificationSource !== undefined
          ? patch.verificationSource
          : existing.verificationSource,
      verificationVersion:
        patch.verificationVersion !== undefined
          ? patch.verificationVersion
          : existing.verificationVersion,
      aiConfidence: patch.aiConfidence !== undefined ? patch.aiConfidence : existing.aiConfidence,
      matchConfidence:
        patch.matchConfidence !== undefined ? patch.matchConfidence : existing.matchConfidence,
      verificationConfidence:
        patch.verificationConfidence !== undefined
          ? patch.verificationConfidence
          : existing.verificationConfidence,
      lastVerifiedAt:
        patch.lastVerifiedAt !== undefined
          ? patch.lastVerifiedAt
          : patch.verificationStatus === 'VERIFIED'
            ? new Date().toISOString()
            : existing.lastVerifiedAt,
      metadata: patch.metadata
        ? { ...existing.metadata, ...patch.metadata }
        : existing.metadata,
    };
    this.products.set(id, next);
    return clone(next);
  }

  async addAlias(catalogProductId: string, alias: string): Promise<void> {
    const a = alias.toLowerCase().trim();
    if (!a) return;
    let set = this.aliases.get(catalogProductId);
    if (!set) {
      set = new Set();
      this.aliases.set(catalogProductId, set);
    }
    set.add(a);
  }

  async listAliases(catalogProductId: string): Promise<string[]> {
    return [...(this.aliases.get(catalogProductId) ?? [])];
  }

  async listActiveForFuzzy(limit = 200): Promise<CatalogProduct[]> {
    return [...this.products.values()]
      .filter((p) => p.status === 'ACTIVE')
      .slice(0, limit)
      .map(clone);
  }
}
