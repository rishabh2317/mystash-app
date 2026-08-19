import { randomUUID } from 'node:crypto';
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

function now(): string {
  return new Date().toISOString();
}

export class InMemoryEngagementRepository implements EngagementRepository {
  facts = new Map<string, InteractionFact>(); // by eventId
  edges = new Map<string, RelationshipEdge>(); // key: user|type|objType|objId
  counters = new Map<string, CounterProjection>();

  private edgeKey(
    userId: string,
    edgeType: EdgeType,
    objectType: string,
    objectId: string,
  ): string {
    return `${userId}|${edgeType}|${objectType}|${objectId}`;
  }

  private counterKey(objectType: string, objectId: string, counterName: string): string {
    return `${objectType}|${objectId}|${counterName}`;
  }

  async insertFact(
    input: RecordFactInput,
  ): Promise<{ fact: InteractionFact; inserted: boolean }> {
    const existing = this.facts.get(input.eventId);
    if (existing) return { fact: existing, inserted: false };

    if (!input.actorUserId && !input.anonymousId) {
      throw new Error('actor_user_id or anonymous_id required');
    }

    const ts = input.occurredAt ?? now();
    const fact: InteractionFact = {
      id: randomUUID(),
      eventId: input.eventId,
      interactionType: input.interactionType,
      objectType: input.objectType,
      objectId: input.objectId,
      actorUserId: input.actorUserId ?? null,
      anonymousId: input.anonymousId ?? null,
      privacyClass: input.privacyClass ?? (input.actorUserId ? 'private' : 'anonymous'),
      collectionId: input.collectionId ?? null,
      collectionProductTagId: input.collectionProductTagId ?? null,
      catalogProductId: input.catalogProductId ?? null,
      creatorId: input.creatorId ?? null,
      sessionId: input.sessionId ?? null,
      surface: input.surface ?? null,
      compensatingForEventId: input.compensatingForEventId ?? null,
      metadata: input.metadata ?? {},
      occurredAt: ts,
      createdAt: now(),
    };
    this.facts.set(fact.eventId, fact);
    return { fact, inserted: true };
  }

  async getFactByEventId(eventId: string): Promise<InteractionFact | null> {
    return this.facts.get(eventId) ?? null;
  }

  async upsertActiveEdge(input: {
    userId: string;
    edgeType: EdgeType;
    objectType: 'creator' | 'collection' | 'catalog_product';
    objectId: string;
    sourceEventId?: string | null;
    privacyClass?: PrivacyClass;
  }): Promise<RelationshipEdge> {
    const key = this.edgeKey(input.userId, input.edgeType, input.objectType, input.objectId);
    const existing = this.edges.get(key);
    const ts = now();
    if (existing) {
      const next: RelationshipEdge = {
        ...existing,
        state: 'ACTIVE',
        sourceEventId: input.sourceEventId ?? existing.sourceEventId,
        privacyClass: input.privacyClass ?? existing.privacyClass,
        updatedAt: ts,
      };
      this.edges.set(key, next);
      return next;
    }
    const edge: RelationshipEdge = {
      id: randomUUID(),
      userId: input.userId,
      edgeType: input.edgeType,
      objectType: input.objectType,
      objectId: input.objectId,
      state: 'ACTIVE',
      sourceEventId: input.sourceEventId ?? null,
      privacyClass: input.privacyClass ?? 'private',
      createdAt: ts,
      updatedAt: ts,
    };
    this.edges.set(key, edge);
    return edge;
  }

  async removeEdge(input: {
    userId: string;
    edgeType: EdgeType;
    objectType: 'creator' | 'collection' | 'catalog_product';
    objectId: string;
  }): Promise<RelationshipEdge | null> {
    const key = this.edgeKey(input.userId, input.edgeType, input.objectType, input.objectId);
    const existing = this.edges.get(key);
    if (!existing || existing.state === 'REMOVED') return existing ?? null;
    const next: RelationshipEdge = { ...existing, state: 'REMOVED', updatedAt: now() };
    this.edges.set(key, next);
    return next;
  }

  async getActiveEdge(input: {
    userId: string;
    edgeType: EdgeType;
    objectType: 'creator' | 'collection' | 'catalog_product';
    objectId: string;
  }): Promise<RelationshipEdge | null> {
    const edge = this.edges.get(
      this.edgeKey(input.userId, input.edgeType, input.objectType, input.objectId),
    );
    return edge?.state === 'ACTIVE' ? edge : null;
  }

  async listActiveEdges(input: {
    userId: string;
    edgeType: EdgeType;
    limit?: number;
  }): Promise<RelationshipEdge[]> {
    const out = [...this.edges.values()].filter(
      (e) => e.userId === input.userId && e.edgeType === input.edgeType && e.state === 'ACTIVE',
    );
    return out.slice(0, input.limit ?? 100);
  }

  async incrementCounter(input: {
    objectType: string;
    objectId: string;
    counterName: CounterName;
    delta?: number;
  }): Promise<CounterProjection> {
    const key = this.counterKey(input.objectType, input.objectId, input.counterName);
    const delta = input.delta ?? 1;
    const existing = this.counters.get(key);
    const next: CounterProjection = {
      objectType: input.objectType as CounterProjection['objectType'],
      objectId: input.objectId,
      counterName: input.counterName,
      value: Math.max(0, (existing?.value ?? 0) + delta),
      updatedAt: now(),
    };
    this.counters.set(key, next);
    return next;
  }

  async getCounter(input: {
    objectType: string;
    objectId: string;
    counterName: CounterName;
  }): Promise<CounterProjection | null> {
    return this.counters.get(this.counterKey(input.objectType, input.objectId, input.counterName)) ?? null;
  }
}
