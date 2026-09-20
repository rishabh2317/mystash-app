import type { CartService } from '../../cart/CartService';
import { getPipelineConfig } from '../../config/pipelineConfig';
import type { DiscoveredProductService } from '../../discovered/DiscoveredProductService';
import type { AiDraftInput, ResolveDraftResult } from '../../product-intelligence/domain/types';
import type { ContentSourceRepository } from '../ContentSourceRepository';
import type { ContentSourceProductRecord } from '../domain/types';
import type { UserImportLookupPort } from '../ports';

export type UserImportResolvePort = {
  resolveForUserImport(drafts: AiDraftInput[]): Promise<ResolveDraftResult[]>;
};

/**
 * Global resolve + per-user Bag fan-out for a content source.
 * Reuses ProductResolver.resolveForUserImport — never a second matcher.
 */
export class ContentSourceResolutionService {
  constructor(
    private readonly sources: ContentSourceRepository,
    private readonly discovered: DiscoveredProductService,
    private readonly resolver: UserImportResolvePort,
    private readonly userImports: UserImportLookupPort,
    private readonly cart: CartService,
  ) {}

  async resolveAndFanOut(contentSourceId: string): Promise<void> {
    await this.resolveProducts(contentSourceId);
    await this.fanOutAll(contentSourceId);
  }

  async resolveProducts(contentSourceId: string): Promise<void> {
    const source = await this.sources.findById(contentSourceId);
    if (!source) return;
    const products = await this.sources.listProducts(source.id);
    const processorVersion = getPipelineConfig().pipelineVersion;

    for (const product of products) {
      if (product.catalogProductId || product.discoveredProductId) continue;
      const draft = toDraft(product);
      const [result] = await this.resolver.resolveForUserImport([draft]);
      if (!result) continue;

      if (result.catalogProductId) {
        await this.sources.bindProductResolution(product.id, {
          catalogProductId: result.catalogProductId,
          discoveredProductId: null,
        });
        continue;
      }

      if (result.discovered) {
        const saved = await this.discovered.getOrCreate(result.discovered, processorVersion);
        await this.sources.bindProductResolution(product.id, {
          catalogProductId: null,
          discoveredProductId: saved.record.id,
        });
      }
    }
  }

  async fanOutAll(contentSourceId: string): Promise<void> {
    const imports = await this.userImports.listByContentSourceId(contentSourceId);
    for (const row of imports) {
      await this.fanOutUser({
        id: row.id,
        userId: row.userId,
        contentSourceId,
      });
    }
  }

  async fanOutUser(row: {
    id: string;
    userId: string;
    contentSourceId: string | null;
  }): Promise<void> {
    if (!row.contentSourceId || !row.userId) return;
    const products = await this.sources.listProducts(row.contentSourceId);
    for (const product of products) {
      await this.addBagLine(row, product);
    }
  }

  private async addBagLine(
    row: { id: string; userId: string; contentSourceId: string | null },
    product: ContentSourceProductRecord,
  ): Promise<void> {
    const source = {
      surface: 'USER_IMPORT' as const,
      contentSourceId: row.contentSourceId,
      userImportId: row.id,
    };
    try {
      if (product.catalogProductId) {
        await this.cart.addItem(row.userId, {
          catalogProductId: product.catalogProductId,
          source,
        });
        return;
      }
      if (product.discoveredProductId) {
        await this.cart.addItem(row.userId, {
          discoveredProductId: product.discoveredProductId,
          source,
        });
      }
    } catch {
      // Fan-out must not fail processing: a later share retries membership.
    }
  }
}

function toDraft(product: ContentSourceProductRecord): AiDraftInput {
  return {
    draftId: product.id,
    externalId: product.externalId,
    name: product.name,
    brand: product.brand,
    model: product.model,
    category: product.category,
    confidence: product.confidence ?? 0.5,
    merchantUrl: product.merchantUrl,
    image: product.image,
    price: product.price,
    currency: product.currency,
    sources: product.sources,
    evidence: product.evidence,
  };
}
