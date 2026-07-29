/** Canonical merchant PDP metadata produced by MerchantEnrichmentService. */

export type MerchantProductMetadata = {
  title: string;
  brand: string | null;
  /** Primary product image (OG / product / JSON-LD / Tavily). */
  image: string | null;
  /** Alias used by some callers — same as image. */
  primaryImage: string | null;
  description: string | null;
  shortDescription: string | null;
  merchant: string;
  merchantUrl: string;
  category: string | null;
  price: string | null;
  currency: string | null;
  availability: string | null;
  /** Structured specs — never flattened. */
  specifications: Record<string, string>;
  priceSource: 'merchant' | 'ai' | 'unknown' | null;
  priceLastVerifiedAt: string | null;
  extractedAt: string;
  provider: string;
  /** 0–100 completeness score. */
  metadataCompleteness: number;
};

export type MerchantEnrichmentInput = {
  merchantUrl: string;
  titleHint?: string | null;
  brandHint?: string | null;
  categoryHint?: string | null;
  ingestId: string;
  traceId: string;
};

export type MerchantEnrichmentResult =
  | { kind: 'ok'; metadata: MerchantProductMetadata }
  | { kind: 'failed'; message: string; provider: string };
