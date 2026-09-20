import type {
  ContentExtractionMethod,
  InsertContentSourceProductRow,
} from '../domain/types';

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
      category: product.category?.trim() || null,
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
