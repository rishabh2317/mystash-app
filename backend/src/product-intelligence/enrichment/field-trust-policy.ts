import type { PageType, SourceType } from '../domain/types';

export type TrustRule = {
  sourceType: SourceType;
  pageType: PageType;
};

export type FieldTrustPolicyKey =
  | 'name'
  | 'brand'
  | 'model'
  | 'category'
  | 'offer'
  | 'image'
  | 'gallery'
  | 'specifications'
  | 'description';

export type FieldTrustPolicy = Record<FieldTrustPolicyKey, readonly TrustRule[]>;

const COMMERCE_PRODUCT_RULES: readonly TrustRule[] = [
  { sourceType: 'MARKETPLACE', pageType: 'PRODUCT' },
  { sourceType: 'OFFICIAL', pageType: 'PRODUCT' },
  { sourceType: 'RETAILER', pageType: 'PRODUCT' },
];

export const FIELD_TRUST_POLICY: FieldTrustPolicy = {
  name: [
    { sourceType: 'OFFICIAL', pageType: 'PRODUCT' },
    { sourceType: 'OFFICIAL', pageType: 'SPECIFICATIONS' },
    { sourceType: 'MARKETPLACE', pageType: 'PRODUCT' },
    { sourceType: 'RETAILER', pageType: 'PRODUCT' },
    { sourceType: 'SPECIFICATION', pageType: 'PRODUCT' },
    { sourceType: 'REVIEW', pageType: 'REVIEW' },
    { sourceType: 'EDITORIAL', pageType: 'EDITORIAL' },
  ],
  brand: [
    { sourceType: 'OFFICIAL', pageType: 'PRODUCT' },
    { sourceType: 'OFFICIAL', pageType: 'SPECIFICATIONS' },
    { sourceType: 'MARKETPLACE', pageType: 'PRODUCT' },
    { sourceType: 'RETAILER', pageType: 'PRODUCT' },
    { sourceType: 'SPECIFICATION', pageType: 'PRODUCT' },
  ],
  model: [
    { sourceType: 'OFFICIAL', pageType: 'SPECIFICATIONS' },
    { sourceType: 'OFFICIAL', pageType: 'PRODUCT' },
    { sourceType: 'SPECIFICATION', pageType: 'PRODUCT' },
    { sourceType: 'MARKETPLACE', pageType: 'PRODUCT' },
    { sourceType: 'RETAILER', pageType: 'PRODUCT' },
  ],
  category: [
    { sourceType: 'OFFICIAL', pageType: 'PRODUCT' },
    { sourceType: 'MARKETPLACE', pageType: 'PRODUCT' },
    { sourceType: 'RETAILER', pageType: 'PRODUCT' },
    { sourceType: 'SPECIFICATION', pageType: 'PRODUCT' },
  ],
  offer: COMMERCE_PRODUCT_RULES,
  image: [
    { sourceType: 'OFFICIAL', pageType: 'PRODUCT' },
    { sourceType: 'MARKETPLACE', pageType: 'PRODUCT' },
    { sourceType: 'RETAILER', pageType: 'PRODUCT' },
    { sourceType: 'SPECIFICATION', pageType: 'PRODUCT' },
    { sourceType: 'REVIEW', pageType: 'REVIEW' },
  ],
  gallery: [
    { sourceType: 'OFFICIAL', pageType: 'PRODUCT' },
    { sourceType: 'MARKETPLACE', pageType: 'PRODUCT' },
    { sourceType: 'SPECIFICATION', pageType: 'PRODUCT' },
    { sourceType: 'RETAILER', pageType: 'PRODUCT' },
  ],
  specifications: [
    { sourceType: 'OFFICIAL', pageType: 'SPECIFICATIONS' },
    { sourceType: 'SPECIFICATION', pageType: 'PRODUCT' },
    { sourceType: 'SPECIFICATION', pageType: 'COMPARISON' },
    { sourceType: 'OFFICIAL', pageType: 'PRODUCT' },
    { sourceType: 'MARKETPLACE', pageType: 'PRODUCT' },
  ],
  description: [
    { sourceType: 'OFFICIAL', pageType: 'PRODUCT' },
    { sourceType: 'REVIEW', pageType: 'REVIEW' },
    { sourceType: 'EDITORIAL', pageType: 'EDITORIAL' },
    { sourceType: 'OFFICIAL', pageType: 'NEWS' },
  ],
};
