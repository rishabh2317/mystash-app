/**
 * @deprecated Use product-intelligence ProductResolver via createProductIntelligence().
 * Kept temporarily so older imports do not break TypeScript builds.
 */
export type CatalogMatch = {
  productExternalId: string;
  catalogSku?: string;
  score: number;
};

export interface CatalogMatcher {
  match(
    products: Array<{ externalId?: string; name: string; confidence: number }>,
  ): Promise<CatalogMatch[]>;
}

/** @deprecated No-op identity matcher — do not use for new code. */
export class NoopCatalogMatcher implements CatalogMatcher {
  async match(
    products: Array<{ externalId?: string; name: string; confidence: number }>,
  ): Promise<CatalogMatch[]> {
    return products.map((p) => ({
      productExternalId: p.externalId ?? p.name,
      score: p.confidence,
    }));
  }
}
