import type { MerchantEnrichmentInput, MerchantProductMetadata } from './types';

/**
 * Pluggable raw merchant page extractor.
 * Implementations: Tavily (current), future Firecrawl / Browserbase / Playwright / Jina.
 */
export type MerchantExtractor = {
  readonly name: string;
  extract(input: MerchantEnrichmentInput): Promise<Partial<MerchantProductMetadata> | null>;
};
