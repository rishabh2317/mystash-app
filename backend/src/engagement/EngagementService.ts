import { randomUUID } from 'node:crypto';
import { buildEngagementEventPayload } from './domain/events';
import type {
  CounterName,
  InteractionFact,
  RecordFactInput,
  RelationshipEdge,
} from './domain/types';
import type { EngagementRepository } from './EngagementRepository';
import { emitEngagementEvent } from './observability';
import type { CollectionCounterDenormPort, UserCounterDenormPort } from './ports';
import { noopCollectionCounterDenorm, noopUserCounterDenorm } from './ports';
import { scheduleSearchEngagementNearline } from '../search/schedule';

export class EngagementServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'EngagementServiceError';
  }
}

export type MerchantClickedInput = {
  eventId?: string;
  actorUserId?: string | null;
  anonymousId?: string | null;
  catalogProductId: string;
  collectionId?: string | null;
  collectionProductTagId?: string | null;
  creatorId?: string | null;
  destinationUrl: string;
  destinationType?: string | null;
  shoppingProvider?: string | null;
  affiliateProvider?: string | null;
  platform?: string | null;
  country?: string | null;
  surface?: string | null;
  occurredAt?: string;
};

/**
 * Engagement application boundary — InteractionFact SoT, relationships, counters.
 */
export class EngagementService {
  /** Throttle CounterUpdated emissions (batch-ish): emit at most once per key per window. */
  private lastCounterEmit = new Map<string, number>();
  private readonly counterEmitWindowMs = 60_000;

  constructor(
    private readonly repo: EngagementRepository,
    private readonly collections: CollectionCounterDenormPort = noopCollectionCounterDenorm,
    private readonly users: UserCounterDenormPort = noopUserCounterDenorm,
  ) {}

  async recordFact(input: RecordFactInput): Promise<{ fact: InteractionFact; inserted: boolean }> {
    if (!input.eventId) throw new EngagementServiceError('event_id required', 400);
    if (!input.actorUserId && !input.anonymousId) {
      throw new EngagementServiceError('actor_user_id or anonymous_id required', 400);
    }
    const result = await this.repo.insertFact(input);
    if (result.inserted) {
      this.emitForFact(result.fact);
    }
    return result;
  }

  async recordCollectionView(params: {
    eventId: string;
    collectionId: string;
    actorUserId?: string | null;
    anonymousId?: string | null;
    creatorId?: string | null;
    surface?: string | null;
  }): Promise<InteractionFact> {
    const { fact, inserted } = await this.recordFact({
      eventId: params.eventId,
      interactionType: 'view',
      objectType: 'collection',
      objectId: params.collectionId,
      actorUserId: params.actorUserId,
      anonymousId: params.anonymousId,
      collectionId: params.collectionId,
      creatorId: params.creatorId,
      surface: params.surface,
      privacyClass: params.actorUserId ? 'private' : 'anonymous',
    });
    if (inserted) {
      await this.bumpAndDenormCollection(params.collectionId, 'views', 'viewsCount');
    }
    return fact;
  }

  async recordCollectionImpression(params: {
    eventId: string;
    collectionId: string;
    actorUserId?: string | null;
    anonymousId?: string | null;
    creatorId?: string | null;
    surface?: string | null;
  }): Promise<InteractionFact> {
    const { fact } = await this.recordFact({
      eventId: params.eventId,
      interactionType: 'impression',
      objectType: 'collection',
      objectId: params.collectionId,
      actorUserId: params.actorUserId,
      anonymousId: params.anonymousId,
      collectionId: params.collectionId,
      creatorId: params.creatorId,
      surface: params.surface,
      privacyClass: params.actorUserId ? 'private' : 'anonymous',
    });
    return fact;
  }

  /** Share intent/completed share — bumps `shares` counter + Collection denorm. */
  async recordCollectionShare(params: {
    eventId: string;
    collectionId: string;
    actorUserId?: string | null;
    anonymousId?: string | null;
    creatorId?: string | null;
    surface?: string | null;
  }): Promise<InteractionFact> {
    const { fact, inserted } = await this.recordFact({
      eventId: params.eventId,
      interactionType: 'share',
      objectType: 'collection',
      objectId: params.collectionId,
      actorUserId: params.actorUserId,
      anonymousId: params.anonymousId,
      collectionId: params.collectionId,
      creatorId: params.creatorId,
      surface: params.surface,
      privacyClass: params.actorUserId ? 'private' : 'anonymous',
    });
    if (inserted) {
      await this.bumpAndDenormCollection(params.collectionId, 'shares', 'sharesCount');
    }
    return fact;
  }

  /**
   * Creator profile share — same `share` InteractionFact model, object = creator.
   * Persists fact + creator `shares` counter projection (no User denorm slot in V1).
   */
  async recordCreatorShare(params: {
    eventId: string;
    creatorId: string;
    actorUserId?: string | null;
    anonymousId?: string | null;
    surface?: string | null;
  }): Promise<InteractionFact> {
    const { fact, inserted } = await this.recordFact({
      eventId: params.eventId,
      interactionType: 'share',
      objectType: 'creator',
      objectId: params.creatorId,
      actorUserId: params.actorUserId,
      anonymousId: params.anonymousId,
      creatorId: params.creatorId,
      surface: params.surface,
      privacyClass: params.actorUserId ? 'private' : 'anonymous',
    });
    if (inserted) {
      const counter = await this.repo.incrementCounter({
        objectType: 'creator',
        objectId: params.creatorId,
        counterName: 'shares',
      });
      this.maybeEmitCounterUpdated('creator', params.creatorId, 'shares', counter.value);
    }
    return fact;
  }

  async followCreator(params: {
    eventId?: string;
    userId: string;
    creatorId: string;
  }): Promise<RelationshipEdge> {
    if (params.userId === params.creatorId) {
      throw new EngagementServiceError('Cannot follow yourself', 400);
    }
    const eventId = params.eventId ?? randomUUID();
    const existing = await this.repo.getActiveEdge({
      userId: params.userId,
      edgeType: 'FOLLOW',
      objectType: 'creator',
      objectId: params.creatorId,
    });
    if (existing) return existing;

    const { fact, inserted } = await this.recordFact({
      eventId,
      interactionType: 'follow',
      objectType: 'creator',
      objectId: params.creatorId,
      actorUserId: params.userId,
      creatorId: params.creatorId,
      privacyClass: 'public',
    });

    const edge = await this.repo.upsertActiveEdge({
      userId: params.userId,
      edgeType: 'FOLLOW',
      objectType: 'creator',
      objectId: params.creatorId,
      sourceEventId: fact.eventId,
      privacyClass: 'public',
    });

    if (inserted) {
      const followers = await this.repo.incrementCounter({
        objectType: 'creator',
        objectId: params.creatorId,
        counterName: 'followers',
      });
      const following = await this.repo.incrementCounter({
        objectType: 'user',
        objectId: params.userId,
        counterName: 'following',
      });
      await this.users.applyUserCounters(params.creatorId, {
        followersCount: followers.value,
      });
      await this.users.applyUserCounters(params.userId, {
        followingCount: following.value,
      });
      this.maybeEmitCounterUpdated('creator', params.creatorId, 'followers', followers.value);
      this.maybeEmitCounterUpdated('user', params.userId, 'following', following.value);
    }
    return edge;
  }

  async unfollowCreator(params: {
    eventId?: string;
    userId: string;
    creatorId: string;
  }): Promise<void> {
    const existing = await this.repo.getActiveEdge({
      userId: params.userId,
      edgeType: 'FOLLOW',
      objectType: 'creator',
      objectId: params.creatorId,
    });
    if (!existing) return;

    const eventId = params.eventId ?? randomUUID();
    const { inserted } = await this.recordFact({
      eventId,
      interactionType: 'unfollow',
      objectType: 'creator',
      objectId: params.creatorId,
      actorUserId: params.userId,
      creatorId: params.creatorId,
      privacyClass: 'public',
    });
    await this.repo.removeEdge({
      userId: params.userId,
      edgeType: 'FOLLOW',
      objectType: 'creator',
      objectId: params.creatorId,
    });
    if (inserted) {
      const followers = await this.repo.incrementCounter({
        objectType: 'creator',
        objectId: params.creatorId,
        counterName: 'followers',
        delta: -1,
      });
      const following = await this.repo.incrementCounter({
        objectType: 'user',
        objectId: params.userId,
        counterName: 'following',
        delta: -1,
      });
      await this.users.applyUserCounters(params.creatorId, {
        followersCount: followers.value,
      });
      await this.users.applyUserCounters(params.userId, {
        followingCount: following.value,
      });
    }
  }

  async saveCollection(params: {
    eventId?: string;
    userId: string;
    collectionId: string;
    creatorId?: string | null;
  }): Promise<RelationshipEdge> {
    const eventId = params.eventId ?? randomUUID();
    const existing = await this.repo.getActiveEdge({
      userId: params.userId,
      edgeType: 'SAVE',
      objectType: 'collection',
      objectId: params.collectionId,
    });
    if (existing) return existing;

    const { fact, inserted } = await this.recordFact({
      eventId,
      interactionType: 'save',
      objectType: 'collection',
      objectId: params.collectionId,
      actorUserId: params.userId,
      collectionId: params.collectionId,
      creatorId: params.creatorId,
      privacyClass: 'private',
    });
    const edge = await this.repo.upsertActiveEdge({
      userId: params.userId,
      edgeType: 'SAVE',
      objectType: 'collection',
      objectId: params.collectionId,
      sourceEventId: fact.eventId,
      privacyClass: 'private',
    });
    if (inserted) {
      await this.bumpAndDenormCollection(params.collectionId, 'saves', 'savesCount');
    }
    return edge;
  }

  async unsaveCollection(params: {
    eventId?: string;
    userId: string;
    collectionId: string;
  }): Promise<void> {
    const existing = await this.repo.getActiveEdge({
      userId: params.userId,
      edgeType: 'SAVE',
      objectType: 'collection',
      objectId: params.collectionId,
    });
    if (!existing) return;

    const eventId = params.eventId ?? randomUUID();
    const { inserted } = await this.recordFact({
      eventId,
      interactionType: 'unsave',
      objectType: 'collection',
      objectId: params.collectionId,
      actorUserId: params.userId,
      collectionId: params.collectionId,
      privacyClass: 'private',
    });
    await this.repo.removeEdge({
      userId: params.userId,
      edgeType: 'SAVE',
      objectType: 'collection',
      objectId: params.collectionId,
    });
    if (inserted) {
      const counter = await this.repo.incrementCounter({
        objectType: 'collection',
        objectId: params.collectionId,
        counterName: 'saves',
        delta: -1,
      });
      await this.collections.applyCollectionCounters(params.collectionId, {
        savesCount: counter.value,
      });
    }
  }

  /**
   * Shopping emits MerchantClicked; Engagement records the fact.
   * Dual-write: caller may still write legacy product_clicks.
   */
  async recordMerchantClicked(input: MerchantClickedInput): Promise<InteractionFact> {
    const eventId = input.eventId ?? randomUUID();
    if (!input.actorUserId && !input.anonymousId) {
      // Allow server-side redirects without actor — use synthetic anonymous.
      input = { ...input, anonymousId: input.anonymousId ?? `redir:${eventId}` };
    }
    const { fact, inserted } = await this.recordFact({
      eventId,
      interactionType: 'merchant_click',
      objectType: 'catalog_product',
      objectId: input.catalogProductId,
      actorUserId: input.actorUserId,
      anonymousId: input.anonymousId,
      privacyClass: 'private',
      catalogProductId: input.catalogProductId,
      collectionId: input.collectionId,
      collectionProductTagId: input.collectionProductTagId,
      creatorId: input.creatorId,
      surface: input.surface ?? 'shopping_redirect',
      occurredAt: input.occurredAt,
      metadata: {
        destinationUrl: input.destinationUrl,
        destinationType: input.destinationType ?? null,
        shoppingProvider: input.shoppingProvider ?? null,
        affiliateProvider: input.affiliateProvider ?? null,
        platform: input.platform ?? null,
        country: input.country ?? null,
      },
    });
    if (inserted) {
      await this.repo.incrementCounter({
        objectType: 'catalog_product',
        objectId: input.catalogProductId,
        counterName: 'merchant_clicks',
      });
      if (input.collectionId) {
        await this.bumpAndDenormCollection(
          input.collectionId,
          'product_clicks',
          'productClicksCount',
        );
      }
    }
    return fact;
  }

  async isFollowing(userId: string, creatorId: string): Promise<boolean> {
    const edge = await this.repo.getActiveEdge({
      userId,
      edgeType: 'FOLLOW',
      objectType: 'creator',
      objectId: creatorId,
    });
    return !!edge;
  }

  async listFollowing(userId: string, limit = 100): Promise<RelationshipEdge[]> {
    return this.repo.listActiveEdges({ userId, edgeType: 'FOLLOW', limit });
  }

  async listSavedCollections(userId: string, limit = 100): Promise<RelationshipEdge[]> {
    return this.repo.listActiveEdges({ userId, edgeType: 'SAVE', limit });
  }

  private async bumpAndDenormCollection(
    collectionId: string,
    counterName: CounterName,
    denormKey: 'viewsCount' | 'savesCount' | 'sharesCount' | 'productClicksCount' | 'purchasesCount',
  ): Promise<void> {
    const counter = await this.repo.incrementCounter({
      objectType: 'collection',
      objectId: collectionId,
      counterName,
    });
    await this.collections.applyCollectionCounters(collectionId, {
      [denormKey]: counter.value,
    });
    this.maybeEmitCounterUpdated('collection', collectionId, counterName, counter.value);
  }

  private maybeEmitCounterUpdated(
    objectType: string,
    objectId: string,
    counterName: string,
    value: number,
  ): void {
    const key = `${objectType}|${objectId}|${counterName}`;
    const t = Date.now();
    const last = this.lastCounterEmit.get(key) ?? 0;
    if (t - last < this.counterEmitWindowMs) return;
    this.lastCounterEmit.set(key, t);
    emitEngagementEvent(
      'CounterUpdated',
      buildEngagementEventPayload({
        objectType,
        objectId,
        counterName,
        counterValue: value,
      }),
    );
    if (objectType === 'collection') {
      const mirrors: {
        viewsCount?: number;
        savesCount?: number;
        sharesCount?: number;
        productClicksCount?: number;
      } = {};
      if (counterName === 'views') mirrors.viewsCount = value;
      if (counterName === 'saves') mirrors.savesCount = value;
      if (counterName === 'shares') mirrors.sharesCount = value;
      if (counterName === 'product_clicks' || counterName === 'productClicks') {
        mirrors.productClicksCount = value;
      }
      if (Object.keys(mirrors).length) {
        scheduleSearchEngagementNearline(objectId, mirrors);
      }
    }
  }

  private emitForFact(fact: InteractionFact): void {
    const base = buildEngagementEventPayload({
      eventId: fact.eventId,
      actorUserId: fact.actorUserId,
      anonymousId: fact.anonymousId,
      objectType: fact.objectType,
      objectId: fact.objectId,
      collectionId: fact.collectionId,
      collectionProductTagId: fact.collectionProductTagId,
      catalogProductId: fact.catalogProductId,
      creatorId: fact.creatorId,
      interactionType: fact.interactionType,
      occurredAt: fact.occurredAt,
    });

    switch (fact.interactionType) {
      case 'impression':
        emitEngagementEvent('CollectionImpressed', base);
        break;
      case 'view':
        emitEngagementEvent('CollectionViewed', base);
        break;
      case 'open':
        emitEngagementEvent('CollectionOpened', base);
        break;
      case 'save':
        emitEngagementEvent('CollectionSaved', base);
        break;
      case 'unsave':
        emitEngagementEvent('CollectionUnsaved', base);
        break;
      case 'share':
        if (fact.objectType === 'creator') {
          // Creator profile share — fact SoT; no CollectionShared emit.
          break;
        }
        emitEngagementEvent('CollectionShared', base);
        break;
      case 'completion':
        emitEngagementEvent('CollectionCompleted', base);
        break;
      case 'view_invalidated':
        emitEngagementEvent('CollectionViewInvalidated', base);
        break;
      case 'follow':
        emitEngagementEvent('CreatorFollowed', base);
        break;
      case 'unfollow':
        emitEngagementEvent('CreatorUnfollowed', base);
        break;
      case 'profile_view':
        emitEngagementEvent('CreatorProfileViewed', base);
        break;
      case 'product_click':
        emitEngagementEvent('ProductClicked', base);
        break;
      case 'merchant_click':
        emitEngagementEvent('MerchantClicked', base);
        break;
      case 'purchase_attributed':
        emitEngagementEvent('PurchaseAttributed', base);
        break;
      default:
        break;
    }
  }
}
