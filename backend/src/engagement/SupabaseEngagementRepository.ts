import type { SupabaseClient } from '@supabase/supabase-js';
import type { EngagementRepository } from './EngagementRepository';
import type {
  CounterName,
  CounterProjection,
  EdgeType,
  InteractionFact,
  PrivacyClass,
  RecordFactInput,
  RelationshipEdge,
} from './domain/types';

type Row = Record<string, unknown>;

function mapFact(row: Row): InteractionFact {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    interactionType: row.interaction_type as InteractionFact['interactionType'],
    objectType: row.object_type as InteractionFact['objectType'],
    objectId: String(row.object_id),
    actorUserId: (row.actor_user_id as string) ?? null,
    anonymousId: (row.anonymous_id as string) ?? null,
    privacyClass: (row.privacy_class as PrivacyClass) ?? 'private',
    collectionId: (row.collection_id as string) ?? null,
    collectionProductTagId: (row.collection_product_tag_id as string) ?? null,
    catalogProductId: (row.catalog_product_id as string) ?? null,
    creatorId: (row.creator_id as string) ?? null,
    sessionId: (row.session_id as string) ?? null,
    surface: (row.surface as string) ?? null,
    compensatingForEventId: (row.compensating_for_event_id as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    occurredAt: String(row.occurred_at),
    createdAt: String(row.created_at),
  };
}

function mapEdge(row: Row): RelationshipEdge {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    edgeType: row.edge_type as EdgeType,
    objectType: row.object_type as RelationshipEdge['objectType'],
    objectId: String(row.object_id),
    state: row.state as RelationshipEdge['state'],
    sourceEventId: (row.source_event_id as string) ?? null,
    privacyClass: (row.privacy_class as PrivacyClass) ?? 'private',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCounter(row: Row): CounterProjection {
  return {
    objectType: row.object_type as CounterProjection['objectType'],
    objectId: String(row.object_id),
    counterName: row.counter_name as CounterName,
    value: Number(row.value) || 0,
    updatedAt: String(row.updated_at),
  };
}

export class SupabaseEngagementRepository implements EngagementRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async insertFact(
    input: RecordFactInput,
  ): Promise<{ fact: InteractionFact; inserted: boolean }> {
    const existing = await this.getFactByEventId(input.eventId);
    if (existing) return { fact: existing, inserted: false };

    const { data, error } = await this.admin
      .from('engagement_interaction_facts')
      .insert({
        event_id: input.eventId,
        interaction_type: input.interactionType,
        object_type: input.objectType,
        object_id: input.objectId,
        actor_user_id: input.actorUserId ?? null,
        anonymous_id: input.anonymousId ?? null,
        privacy_class: input.privacyClass ?? (input.actorUserId ? 'private' : 'anonymous'),
        collection_id: input.collectionId ?? null,
        collection_product_tag_id: input.collectionProductTagId ?? null,
        catalog_product_id: input.catalogProductId ?? null,
        creator_id: input.creatorId ?? null,
        session_id: input.sessionId ?? null,
        surface: input.surface ?? null,
        compensating_for_event_id: input.compensatingForEventId ?? null,
        metadata: input.metadata ?? {},
        occurred_at: input.occurredAt ?? new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      // Race: unique violation → fetch existing
      if (error.code === '23505') {
        const again = await this.getFactByEventId(input.eventId);
        if (again) return { fact: again, inserted: false };
      }
      throw new Error(error.message);
    }
    return { fact: mapFact(data as Row), inserted: true };
  }

  async getFactByEventId(eventId: string): Promise<InteractionFact | null> {
    const { data } = await this.admin
      .from('engagement_interaction_facts')
      .select('*')
      .eq('event_id', eventId)
      .maybeSingle();
    return data ? mapFact(data as Row) : null;
  }

  async upsertActiveEdge(input: {
    userId: string;
    edgeType: EdgeType;
    objectType: 'creator' | 'collection' | 'catalog_product';
    objectId: string;
    sourceEventId?: string | null;
    privacyClass?: PrivacyClass;
  }): Promise<RelationshipEdge> {
    const existing = await this.getActiveEdge(input);
    if (existing) {
      const { data, error } = await this.admin
        .from('engagement_relationship_edges')
        .update({
          source_event_id: input.sourceEventId ?? existing.sourceEventId,
          privacy_class: input.privacyClass ?? existing.privacyClass,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'edge update failed');
      return mapEdge(data as Row);
    }

    // Reactivate removed edge if present
    const { data: removed } = await this.admin
      .from('engagement_relationship_edges')
      .select('*')
      .eq('user_id', input.userId)
      .eq('edge_type', input.edgeType)
      .eq('object_type', input.objectType)
      .eq('object_id', input.objectId)
      .eq('state', 'REMOVED')
      .maybeSingle();

    if (removed) {
      const { data, error } = await this.admin
        .from('engagement_relationship_edges')
        .update({
          state: 'ACTIVE',
          source_event_id: input.sourceEventId ?? null,
          privacy_class: input.privacyClass ?? 'private',
          updated_at: new Date().toISOString(),
        })
        .eq('id', (removed as Row).id)
        .select('*')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'edge reactivate failed');
      return mapEdge(data as Row);
    }

    const { data, error } = await this.admin
      .from('engagement_relationship_edges')
      .insert({
        user_id: input.userId,
        edge_type: input.edgeType,
        object_type: input.objectType,
        object_id: input.objectId,
        state: 'ACTIVE',
        source_event_id: input.sourceEventId ?? null,
        privacy_class: input.privacyClass ?? 'private',
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'edge insert failed');
    return mapEdge(data as Row);
  }

  async removeEdge(input: {
    userId: string;
    edgeType: EdgeType;
    objectType: 'creator' | 'collection' | 'catalog_product';
    objectId: string;
  }): Promise<RelationshipEdge | null> {
    const existing = await this.getActiveEdge(input);
    if (!existing) return null;
    const { data, error } = await this.admin
      .from('engagement_relationship_edges')
      .update({ state: 'REMOVED', updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'edge remove failed');
    return mapEdge(data as Row);
  }

  async getActiveEdge(input: {
    userId: string;
    edgeType: EdgeType;
    objectType: 'creator' | 'collection' | 'catalog_product';
    objectId: string;
  }): Promise<RelationshipEdge | null> {
    const { data } = await this.admin
      .from('engagement_relationship_edges')
      .select('*')
      .eq('user_id', input.userId)
      .eq('edge_type', input.edgeType)
      .eq('object_type', input.objectType)
      .eq('object_id', input.objectId)
      .eq('state', 'ACTIVE')
      .maybeSingle();
    return data ? mapEdge(data as Row) : null;
  }

  async listActiveEdges(input: {
    userId: string;
    edgeType: EdgeType;
    limit?: number;
  }): Promise<RelationshipEdge[]> {
    const { data } = await this.admin
      .from('engagement_relationship_edges')
      .select('*')
      .eq('user_id', input.userId)
      .eq('edge_type', input.edgeType)
      .eq('state', 'ACTIVE')
      .order('updated_at', { ascending: false })
      .limit(input.limit ?? 100);
    return (data ?? []).map((r) => mapEdge(r as Row));
  }

  async incrementCounter(input: {
    objectType: string;
    objectId: string;
    counterName: CounterName;
    delta?: number;
  }): Promise<CounterProjection> {
    const delta = input.delta ?? 1;
    const existing = await this.getCounter(input);
    const nextValue = Math.max(0, (existing?.value ?? 0) + delta);
    const { data, error } = await this.admin
      .from('engagement_counter_projections')
      .upsert(
        {
          object_type: input.objectType,
          object_id: input.objectId,
          counter_name: input.counterName,
          value: nextValue,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'object_type,object_id,counter_name' },
      )
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'counter upsert failed');
    return mapCounter(data as Row);
  }

  async getCounter(input: {
    objectType: string;
    objectId: string;
    counterName: CounterName;
  }): Promise<CounterProjection | null> {
    const { data } = await this.admin
      .from('engagement_counter_projections')
      .select('*')
      .eq('object_type', input.objectType)
      .eq('object_id', input.objectId)
      .eq('counter_name', input.counterName)
      .maybeSingle();
    return data ? mapCounter(data as Row) : null;
  }
}
