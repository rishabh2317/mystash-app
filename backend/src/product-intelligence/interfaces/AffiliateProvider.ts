export type AffiliateResolveInput = {
  merchantUrl: string;
  catalogProductId: string | null;
  ingestId?: string;
  index?: number;
};

export type AffiliateResolveResult = {
  affiliateUrl: string;
  provider: string;
  expiresAt: Date;
};

export type AffiliateProvider = {
  readonly name: string;
  resolve(input: AffiliateResolveInput): Promise<AffiliateResolveResult>;
};
