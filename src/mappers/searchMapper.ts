import type { SearchResultCard } from '@/src/services/searchApi';
import type { CatalogProductViewModel, CatalogVerificationStatus } from '@/src/types/catalogProduct';
import type { CollectionViewModel } from '@/src/types/collection';
import type { CreatorViewModel } from '@/src/types/creator';

function asVerification(raw: string | null | undefined): CatalogVerificationStatus {
  if (raw === 'VERIFIED' || raw === 'UNVERIFIED' || raw === 'UNRESOLVED') return raw;
  return 'UNRESOLVED';
}

/** Map a Collection Search hit → CollectionViewModel. Never uses video id. */
export function mapSearchCollectionCard(card: SearchResultCard): CollectionViewModel | null {
  if (card.entityType !== 'collection') return null;
  const collectionId = card.id.trim();
  if (!collectionId) return null;
  const creator = card.creator;
  return {
    collectionId,
    slug: card.slug?.trim() || collectionId,
    title: card.title?.trim() || null,
    heroThumbnailUrl: card.primaryMediaRef ?? card.imageRef ?? null,
    productCount: typeof card.productTagCount === 'number' ? card.productTagCount : 0,
    publishedAt: null,
    creator: {
      id: creator?.creatorId?.trim() || 'unknown',
      username: creator?.username ?? null,
      displayName: creator?.displayName ?? null,
      avatarUrl: creator?.avatarRef ?? null,
    },
    counters: {
      views: typeof card.viewsCount === 'number' ? card.viewsCount : 0,
      saves: typeof card.savesCount === 'number' ? card.savesCount : 0,
    },
  };
}

/**
 * Map a Creator Search hit → CreatorViewModel (partial stats OK for Search cards).
 * Requires username for `/creator/[username]` navigation.
 */
export function mapSearchCreatorCard(card: SearchResultCard): CreatorViewModel | null {
  if (card.entityType !== 'creator') return null;
  const userId = card.id.trim();
  const username = (card.username ?? '').trim().replace(/^@/, '');
  if (!userId || !username) return null;
  return {
    userId,
    username,
    displayName: card.title?.trim() || null,
    avatarUrl: card.imageRef ?? null,
    bio: null,
    websiteUrl: null,
    socialLinks: {},
    creatorStatus: 'ACTIVE',
    isCreator: true,
    accountType: 'personal',
    joinedAt: '',
    followersCount: typeof card.followersCount === 'number' ? card.followersCount : 0,
    followingCount: 0,
    collectionCount: 0,
    savesCount: 0,
  };
}

/** Thin fallback when Catalog hydrate misses a row. */
export function mapSearchProductCardThin(card: SearchResultCard): CatalogProductViewModel | null {
  if (card.entityType !== 'product') return null;
  const catalogProductId = card.id.trim();
  if (!catalogProductId) return null;
  const hero = card.imageRef?.startsWith('http') ? card.imageRef : null;
  const indexPrice = card.price?.trim() || null;
  const indexCurrency = card.priceCurrency?.trim() || null;
  return {
    id: catalogProductId,
    catalogProductId,
    title: card.title?.trim() || 'Product',
    brand: card.subtitle?.split('·')[0]?.trim() || null,
    merchant: null,
    heroImage: hero,
    galleryImages: hero ? [hero] : [],
    description: null,
    shortDescription: card.matchReason ?? null,
    specifications: {},
    verificationStatus: asVerification(card.verificationStatus),
    availability: null,
    price: indexPrice,
    currency: indexCurrency,
    lastVerifiedAt: null,
    metadataCompleteness: null,
  };
}

export function dedupeById<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
