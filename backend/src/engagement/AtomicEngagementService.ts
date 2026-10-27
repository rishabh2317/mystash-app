import { currentMeasurement } from '../analytics/context';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EngagementService, EngagementServiceError } from './EngagementService';
import { SupabaseEngagementRepository, mapEdge, mapFact } from './SupabaseEngagementRepository';
import type { InteractionFact, RecordFactInput, RelationshipEdge } from './domain/types';
import { getEligiblePublicReel } from './reelEligibility';
import { noopCollectionCounterDenorm, noopUserCounterDenorm } from './ports';
import {
  collectionSavedEvent, creatorFollowedEvent, reelLikedEvent, type NotificationEmitter,
} from '../notifications/producers';

type CommitResult = { fact: InteractionFact | null; inserted: boolean; edge: RelationshipEdge | null };
type Params<K extends keyof EngagementService> = EngagementService[K] extends (...args: infer A) => unknown ? A[0] : never;

/** Production writes use one Postgres transaction; read contracts remain unchanged. */
export class AtomicEngagementService extends EngagementService {
  constructor(private readonly admin: SupabaseClient, private readonly emitter: NotificationEmitter) {
    super(new SupabaseEngagementRepository(admin), noopCollectionCounterDenorm, noopUserCounterDenorm,
      { getEligiblePublicReel: (id) => getEligiblePublicReel(admin, id) }, emitter);
  }

  private async commit(input: RecordFactInput): Promise<CommitResult> {
    const measurement = currentMeasurement();
    const payload = { p_fact: {
      session_id: measurement?.sessionId ?? null,
      measurement_revision: measurement?.revision ?? null,
      measurement_context: input.measurementRequested ?? !!measurement,
      event_id: input.eventId, interaction_type: input.interactionType, object_type: input.objectType,
      object_id: input.objectId, actor_user_id: input.actorUserId ?? null, anonymous_id: input.anonymousId ?? null,
      collection_id: input.collectionId ?? null, catalog_product_id: input.catalogProductId ?? null,
      collection_product_tag_id: input.collectionProductTagId ?? null, creator_id: input.creatorId ?? null,
      surface: input.surface ?? null, metadata: input.metadata ?? {}, occurred_at: input.occurredAt ?? null,
    } };
    let response = await this.admin.rpc('engagement_commit', payload);
    for (let attempt = 1; attempt <= 2 && ['40P01', '40001'].includes(response.error?.code ?? ''); attempt++) {
      // These SQL errors roll back the whole transaction; reuse the event ID on retry.
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
      response = await this.admin.rpc('engagement_commit', payload);
    }
    const { data, error } = response;
    if (error) {
      const status = error.code === '23505' ? 409 : error.code === 'P0002' ? 404
        : ['22023', '22P02', '23514'].includes(error.code) ? 400 : 500;
      throw new EngagementServiceError(status === 500 ? 'Engagement write failed' : error.message, status);
    }
    const result: CommitResult = {
      fact: data.fact ? mapFact(data.fact) : null,
      inserted: data.inserted === true,
      edge: data.edge?.id ? mapEdge(data.edge) : null,
    };
    if (result.fact && result.inserted) this.emitForFact(result.fact);
    // Re-read committed counters, never replay an old absolute mirror write in application code.
    if (result.fact?.collectionId) {
      const { data: counters, error: readError } = await this.admin.from('engagement_counter_projections')
        .select('counter_name,value').eq('object_type', 'collection').eq('object_id', result.fact.collectionId);
      if (!readError) for (const counter of counters ?? []) {
        this.maybeEmitCounterUpdated('collection', result.fact.collectionId, counter.counter_name, Number(counter.value));
      }
    }
    // Notification idempotency keys are fact-based, so retries can recover post-commit delivery.
    const fact = result.fact;
    if (fact?.actorUserId && fact.creatorId && fact.creatorId !== fact.actorUserId &&
      result.edge?.state === 'ACTIVE' && result.edge.sourceEventId === fact.eventId) {
      const base = { factEventId: fact.eventId, recipientUserId: fact.creatorId,
        actorUserId: fact.actorUserId, occurredAt: fact.createdAt };
      if (fact.interactionType === 'follow') await this.emitter.emitSafely(creatorFollowedEvent(base));
      if (fact.interactionType === 'save' && fact.collectionId) {
        await this.emitter.emitSafely(collectionSavedEvent({ ...base, collectionId: fact.collectionId }));
      }
      if (fact.interactionType === 'like' && fact.collectionId) {
        await this.emitter.emitSafely(reelLikedEvent({ ...base, collectionId: fact.collectionId }));
      }
    }
    return result;
  }

  override async recordFact(input: RecordFactInput) {
    const result = await this.commit(input);
    if (!result.fact) throw new EngagementServiceError('Relationship already in requested state', 409);
    return { fact: result.fact, inserted: result.inserted };
  }

  private async collectionAction(type: 'view' | 'impression' | 'share', p: Params<'recordCollectionView'>) {
    const r = await this.commit({ eventId: p.eventId, interactionType: type, objectType: 'collection',
      objectId: p.collectionId, collectionId: p.collectionId, actorUserId: p.actorUserId,
      anonymousId: p.anonymousId, surface: p.surface });
    if (!r.fact) throw new Error('Missing committed fact');
    return { ...r.fact, inserted: r.inserted };
  }
  override recordCollectionView(p: Params<'recordCollectionView'>) { return this.collectionAction('view', p); }
  override recordCollectionImpression(p: Params<'recordCollectionImpression'>) { return this.collectionAction('impression', p); }
  override recordCollectionShare(p: Params<'recordCollectionShare'>) { return this.collectionAction('share', p); }
  override async recordCreatorShare(p: Params<'recordCreatorShare'>) {
    return (await this.recordFact({ eventId: p.eventId, interactionType: 'share', objectType: 'creator',
      objectId: p.creatorId, actorUserId: p.actorUserId, anonymousId: p.anonymousId, surface: p.surface })).fact;
  }

  private async relationship(type: 'follow' | 'unfollow' | 'save' | 'unsave' | 'like' | 'unlike',
    userId: string, objectId: string, eventId?: string, surface?: string | null) {
    const objectType = type.includes('follow') ? 'creator' : type.includes('save') ? 'collection' : 'reel';
    const result = await this.commit({ eventId: eventId ?? randomUUID(), interactionType: type, objectType,
      objectId, actorUserId: userId, collectionId: objectType === 'collection' ? objectId : null, surface });
    // A duplicate event cannot reapply an old edge transition. Return its current state.
    if (!result.edge) {
      const { data, error } = await this.admin.from('engagement_relationship_edges').select('*')
        .eq('user_id', userId).eq('object_type', objectType).eq('object_id', objectId)
        .eq('edge_type', objectType === 'creator' ? 'FOLLOW' : objectType === 'collection' ? 'SAVE' : 'LIKE')
        .eq('state', 'ACTIVE').maybeSingle();
      if (error) throw new Error(error.message);
      result.edge = data ? mapEdge(data) : null;
    }
    return result;
  }
  override async followCreator(p: Params<'followCreator'>) {
    const r = await this.relationship('follow', p.userId, p.creatorId, p.eventId);
    if (!r.edge || r.edge.state !== 'ACTIVE') throw new EngagementServiceError('Follow no longer active', 409);
    return r.edge;
  }
  override async unfollowCreator(p: Params<'unfollowCreator'>) {
    await this.relationship('unfollow', p.userId, p.creatorId, p.eventId);
  }
  override async saveCollection(p: Params<'saveCollection'>) {
    const r = await this.relationship('save', p.userId, p.collectionId, p.eventId);
    if (!r.edge || r.edge.state !== 'ACTIVE') throw new EngagementServiceError('Save no longer active', 409);
    return r.edge;
  }
  override async unsaveCollection(p: Params<'unsaveCollection'>) {
    await this.relationship('unsave', p.userId, p.collectionId, p.eventId);
  }
  override async likeReel(p: Params<'likeReel'>): Promise<{ liked: true; likeCount: number }> {
    await this.relationship('like', p.userId, p.reelId, p.eventId, p.surface);
    const summary = await this.getReelLikeSummary(p.reelId, p.userId);
    if (!summary.liked) throw new EngagementServiceError('Like no longer active', 409);
    return { liked: true, likeCount: summary.likeCount };
  }
  override async unlikeReel(p: Params<'unlikeReel'>): Promise<{ liked: false; likeCount: number }> {
    await this.relationship('unlike', p.userId, p.reelId, p.eventId, p.surface);
    const summary = await this.getReelLikeSummary(p.reelId, p.userId);
    if (summary.liked) throw new EngagementServiceError('Unlike superseded by a later like', 409);
    return { liked: false, likeCount: summary.likeCount };
  }
  override async recordMerchantClicked(p: Params<'recordMerchantClicked'>) {
    const eventId = p.eventId ?? randomUUID();
    let host: string | null = null;
    try { host = new URL(p.destinationUrl).hostname; } catch { /* Invalid destination is not persisted. */ }
    return (await this.recordFact({ measurementRequested:p.measurementRequested,eventId, interactionType: 'merchant_click', objectType: 'catalog_product',
      objectId: p.catalogProductId, catalogProductId: p.catalogProductId, collectionId: p.collectionId,
      collectionProductTagId: p.collectionProductTagId, actorUserId: p.actorUserId,
      anonymousId: p.anonymousId ?? (!p.actorUserId ? `redir:${eventId}` : null),
      surface: p.surface ?? 'shopping_redirect', occurredAt: p.occurredAt,
      metadata: { destinationHost: host, destinationType: p.destinationType ?? null,
        shoppingProvider: p.shoppingProvider ?? null, affiliateProvider: p.affiliateProvider ?? null,
        platform: p.platform ?? null, country: p.country ?? null },
    })).fact;
  }
}
