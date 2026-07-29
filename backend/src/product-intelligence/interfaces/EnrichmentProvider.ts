/** Reserved for future PDP enrichment providers. */
export type EnrichmentInput = {
  merchantUrl: string;
  titleHint?: string | null;
};

export type EnrichmentResult = {
  title?: string;
  description?: string;
  imageUrl?: string;
  price?: string;
  currency?: string;
  availability?: string;
};

export type EnrichmentProvider = {
  readonly name: string;
  enrich(input: EnrichmentInput): Promise<EnrichmentResult | null>;
};
