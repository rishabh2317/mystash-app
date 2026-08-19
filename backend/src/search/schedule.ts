/**
 * Fire-and-forget Search projection scheduling.
 * Never blocks write-domain success; never swaps to InMemory on OpenSearch failure.
 */
import { createSupabaseAdmin } from '../supabase';
import type { CatalogProduct } from '../catalog/domain/types';
import type { User } from '../user/domain/types';
import type { Collection } from '../collection/domain/types';
import { catalogProductToSearchIndexInput } from './catalogBridge';
import { collectionToSearchIndexInput } from './collectionBridge';
import { createSearchEventConsumer } from './eventConsumer';
import { getSharedSearchService } from './factory';
import { userToCreatorIndexInput } from './userBridge';

function runAsync(label: string, fn: () => Promise<void>): void {
  void fn().catch((e) => {
    // Eventually consistent — log via consumer ops; do not throw into write path
    try {
      // eslint-disable-next-line no-console
      console.warn(`[search-schedule] ${label}:`, e instanceof Error ? e.message : e);
    } catch {
      /* ignore */
    }
  });
}

export function scheduleSearchCollectionProjection(collection: Collection): void {
  runAsync('collection', async () => {
    const consumer = createSearchEventConsumer(getSharedSearchService());
    if (!collection.searchEligible || collection.deletedAt) {
      await consumer.onCollectionUnsearchable(collection.id);
      return;
    }
    await consumer.onCollectionPublishedOrUpdated(collectionToSearchIndexInput(collection));
  });
}

export function scheduleSearchCollectionRemoval(collectionId: string): void {
  runAsync('collection-remove', async () => {
    await createSearchEventConsumer(getSharedSearchService()).onCollectionUnsearchable(
      collectionId,
    );
  });
}

export function scheduleSearchUserProjection(user: User): void {
  runAsync('user-creator', async () => {
    const search = getSharedSearchService();
    const consumer = createSearchEventConsumer(search);
    const input = userToCreatorIndexInput(user);
    if (!input.searchEligible || input.deleted) {
      await search.deleteEntity('creator', user.id);
    } else {
      await consumer.onCreatorUpdated(input);
    }
    // Async fan-out of creator snapshot onto Collection docs (no sync User join on query)
    try {
      const admin = createSupabaseAdmin();
      const { data } = await admin
        .from('collections')
        .select('id')
        .eq('creator_id', user.id)
        .is('deleted_at', null)
        .limit(500);
      const collectionIds = (data ?? []).map((r) => String((r as { id: string }).id));
      if (collectionIds.length) {
        await consumer.onCreatorSnapshotFanout({
          creatorId: user.id,
          displayName: user.displayName,
          username: user.username,
          avatarRef: user.profilePhotoUrl,
          collectionIds,
        });
      }
    } catch {
      /* fan-out best-effort */
    }
  });
}

export function scheduleSearchCatalogProduct(product: CatalogProduct): void {
  runAsync('catalog-product', async () => {
    const consumer = createSearchEventConsumer(getSharedSearchService());
    const input = catalogProductToSearchIndexInput(product);
    if (!input.searchEligible || input.deleted) {
      await consumer.onProductRemoved(product.id);
      return;
    }
    await consumer.onProductUpsert(input);
  });
}

export function scheduleSearchCatalogProductRemoved(catalogProductId: string): void {
  runAsync('catalog-product-remove', async () => {
    await createSearchEventConsumer(getSharedSearchService()).onProductRemoved(catalogProductId);
  });
}

/** Nearline Engagement → Search ranking mirrors (throttled by Engagement emitter). */
export function scheduleSearchEngagementNearline(
  collectionId: string,
  mirrors: {
    viewsCount?: number;
    savesCount?: number;
    sharesCount?: number;
    productClicksCount?: number;
  },
): void {
  runAsync('engagement-nearline', async () => {
    await createSearchEventConsumer(getSharedSearchService()).onCollectionEngagementNearline(
      collectionId,
      mirrors,
    );
  });
}
