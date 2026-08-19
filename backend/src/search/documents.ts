import type {
  CatalogProductSearchDocument,
  CollectionSearchDocument,
  CreatorSearchDocument,
  CreatorSnapshotDenorm,
} from './domain/types';

export type CollectionIndexInput = {
  collectionId: string;
  slug: string;
  searchTitle: string | null;
  searchText: string | null;
  searchKeywords?: string[];
  searchBrands?: string[];
  searchCategories?: string[];
  searchEligible: boolean;
  contentRevision: number;
  creator: CreatorSnapshotDenorm;
  primaryMediaRef?: string | null;
  productTagCount?: number;
  publishedAt?: string | null;
  qualityScore?: number | null;
  viewsCount?: number;
  savesCount?: number;
  sharesCount?: number;
  productClicksCount?: number;
  creatorAuthority?: number;
  saveRate?: number | null;
  deleted?: boolean;
};

export function buildCollectionSearchDocument(
  input: CollectionIndexInput,
): CollectionSearchDocument {
  const searchableText = [
    input.searchTitle,
    input.searchText,
    ...(input.searchKeywords ?? []),
    ...(input.searchBrands ?? []),
    ...(input.searchCategories ?? []),
    input.creator.displayName,
    input.creator.username,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    id: input.collectionId,
    entityType: 'collection',
    collectionId: input.collectionId,
    slug: input.slug,
    searchableText,
    searchTitle: input.searchTitle,
    searchKeywords: input.searchKeywords ?? [],
    searchBrands: input.searchBrands ?? [],
    searchCategories: input.searchCategories ?? [],
    searchEligible: input.searchEligible && !input.deleted,
    contentRevision: input.contentRevision,
    indexedAt: new Date().toISOString(),
    deleted: input.deleted,
    creator: input.creator,
    primaryMediaRef: input.primaryMediaRef ?? null,
    productTagCount: input.productTagCount ?? 0,
    publishedAt: input.publishedAt ?? null,
    qualityScore: input.qualityScore ?? null,
    viewsCount: input.viewsCount ?? 0,
    savesCount: input.savesCount ?? 0,
    sharesCount: input.sharesCount ?? 0,
    productClicksCount: input.productClicksCount ?? 0,
    creatorAuthority: input.creatorAuthority ?? 0,
    saveRate: input.saveRate ?? null,
  };
}

export type CreatorIndexInput = {
  userId: string;
  username: string;
  displayName?: string | null;
  bio?: string | null;
  avatarRef?: string | null;
  followersCount?: number;
  creatorAuthority?: number;
  searchEligible?: boolean;
  contentRevision?: number;
  deleted?: boolean;
};

export function buildCreatorSearchDocument(input: CreatorIndexInput): CreatorSearchDocument {
  const searchableText = [input.displayName, input.username, input.bio]
    .filter(Boolean)
    .join(' ');
  return {
    id: input.userId,
    entityType: 'creator',
    userId: input.userId,
    username: input.username,
    displayName: input.displayName ?? null,
    bio: input.bio ?? null,
    avatarRef: input.avatarRef ?? null,
    searchableText,
    searchEligible: (input.searchEligible ?? true) && !input.deleted,
    contentRevision: input.contentRevision ?? 1,
    indexedAt: new Date().toISOString(),
    deleted: input.deleted,
    followersCount: input.followersCount ?? 0,
    creatorAuthority: input.creatorAuthority ?? 0,
  };
}

export type ProductIndexInput = {
  catalogProductId: string;
  canonicalSlug?: string | null;
  name: string;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  aliases?: string[];
  verificationStatus?: string | null;
  primaryImageRef?: string | null;
  popularity?: number;
  lastVerifiedAt?: string | null;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  searchEligible?: boolean;
  contentRevision?: number;
  deleted?: boolean;
};

export function buildProductSearchDocument(
  input: ProductIndexInput,
): CatalogProductSearchDocument {
  const searchableText = [
    input.name,
    input.brand,
    input.model,
    input.category,
    ...(input.aliases ?? []),
  ]
    .filter(Boolean)
    .join(' ');
  return {
    id: input.catalogProductId,
    entityType: 'product',
    catalogProductId: input.catalogProductId,
    canonicalSlug: input.canonicalSlug ?? null,
    name: input.name,
    brand: input.brand ?? null,
    model: input.model ?? null,
    category: input.category ?? null,
    aliases: input.aliases ?? [],
    verificationStatus: input.verificationStatus ?? null,
    primaryImageRef: input.primaryImageRef ?? null,
    searchableText,
    searchEligible: (input.searchEligible ?? true) && !input.deleted,
    contentRevision: input.contentRevision ?? 1,
    indexedAt: new Date().toISOString(),
    deleted: input.deleted,
    popularity: input.popularity ?? 0,
    lastVerifiedAt: input.lastVerifiedAt ?? null,
    priceAmount: input.priceAmount ?? null,
    priceCurrency: input.priceCurrency ?? null,
  };
}
