import type {
  ContentExtractionMethod,
  InsertContentSourceProductRow,
} from '../domain/types';
import { resolvePersistableCategory } from '../../product-intelligence/domain/categoryTaxonomy';

export type MappedProductInput = {
  name: string;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  confidence?: number | null;
  evidence?: unknown;
  sources?: string[];
  price?: string | null;
  currency?: string | null;
  merchantUrl?: string | null;
  image?: string | null;
  externalId?: string | null;
  sortOrder?: number | null;
};

function asEvidence(
  value: unknown,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const extras = Object.fromEntries(
    Object.entries(extra).filter(([, v]) => v !== undefined),
  );
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>), ...extras };
  }
  if (typeof value === 'string' && value.length > 0) {
    return { summary: value, ...extras };
  }
  return extras;
}

/**
 * Maps extracted products onto content_source_products rows.
 * Does not invent names, brands, or prices — missing values stay null.
 */
export function mapExtractedProducts(params: {
  contentSourceId: string;
  products: MappedProductInput[];
  extractionMethod: ContentExtractionMethod;
  processorVersion: string;
  sourceMetadata?: Record<string, unknown>;
}): InsertContentSourceProductRow[] {
  const used = new Set<string>();
  const rows: InsertContentSourceProductRow[] = [];

  params.products.forEach((product, index) => {
    const name = product.name?.trim();
    if (!name) return;

    const position = product.sortOrder && product.sortOrder > 0 ? product.sortOrder : index + 1;
    const baseId = product.externalId?.trim() || `candidate:${position}`;
    const externalId = used.has(baseId) ? `${baseId}:${position}` : baseId;
    used.add(externalId);

    rows.push({
      contentSourceId: params.contentSourceId,
      position,
      externalId,
      name,
      brand: product.brand?.trim() || null,
      model: product.model?.trim() || null,
      category: resolvePersistableCategory(product.category),
      price: product.price?.trim() || null,
      currency: product.currency?.trim() || null,
      image: product.image?.trim() || null,
      merchantUrl: product.merchantUrl?.trim() || null,
      confidence: typeof product.confidence === 'number' ? product.confidence : null,
      extractionMethod: params.extractionMethod,
      sources: Array.isArray(product.sources) ? product.sources : [],
      evidence: asEvidence(product.evidence, {
        sourceMetadata: params.sourceMetadata ?? null,
      }),
      processorVersion: params.processorVersion,
    });
  });

  return rows;
}

/**
 * Cap Discover Anywhere candidates before persistence / enrichment.
 * Preserves highest-confidence first, then original sort order.
 * Uses pipelineConfig.maxProductsPerImport — not creator ingest caps.
 */
export function limitProductsForUserImport<T extends MappedProductInput>(
  products: T[],
  max: number,
): T[] {
  const limit = Math.max(1, Math.floor(max));
  if (products.length <= limit) return products;
  const ranked = products
    .map((product, index) => ({ product, index }))
    .sort((a, b) => {
      const ca = typeof a.product.confidence === 'number' ? a.product.confidence : -1;
      const cb = typeof b.product.confidence === 'number' ? b.product.confidence : -1;
      if (cb !== ca) return cb - ca;
      const sa =
        typeof a.product.sortOrder === 'number' && a.product.sortOrder > 0
          ? a.product.sortOrder
          : a.index;
      const sb =
        typeof b.product.sortOrder === 'number' && b.product.sortOrder > 0
          ? b.product.sortOrder
          : b.index;
      return sa - sb;
    })
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.product);
  return ranked;
}
