import type { ProductCandidate } from '../domain/types';

/**
 * Catalog matcher stub — canonical product → catalog search → affiliate later.
 * No network calls in Phase E.
 */
export type CatalogMatch = {
  productExternalId: string;
  catalogSku?: string;
  score: number;
};

export interface CatalogMatcher {
  match(products: ProductCandidate[]): Promise<CatalogMatch[]>;
}

export class NoopCatalogMatcher implements CatalogMatcher {
  async match(products: ProductCandidate[]): Promise<CatalogMatch[]> {
    return products.map((p) => ({
      productExternalId: p.externalId ?? p.name,
      score: p.confidence,
    }));
  }
}
