import type {
  CounterName,
  CounterProjection,
  EdgeType,
  InteractionFact,
  RecordFactInput,
  RelationshipEdge,
} from './domain/types';

export type EngagementRepository = {
  insertFact(input: RecordFactInput): Promise<{ fact: InteractionFact; inserted: boolean }>;
  getFactByEventId(eventId: string): Promise<InteractionFact | null>;

  upsertActiveEdge(input: {
    userId: string;
    edgeType: EdgeType;
    objectType: 'creator' | 'collection' | 'catalog_product';
    objectId: string;
    sourceEventId?: string | null;
    privacyClass?: 'public' | 'private' | 'anonymous';
  }): Promise<RelationshipEdge>;

  removeEdge(input: {
    userId: string;
    edgeType: EdgeType;
    objectType: 'creator' | 'collection' | 'catalog_product';
    objectId: string;
  }): Promise<RelationshipEdge | null>;

  getActiveEdge(input: {
    userId: string;
    edgeType: EdgeType;
    objectType: 'creator' | 'collection' | 'catalog_product';
    objectId: string;
  }): Promise<RelationshipEdge | null>;

  listActiveEdges(input: {
    userId: string;
    edgeType: EdgeType;
    limit?: number;
  }): Promise<RelationshipEdge[]>;

  incrementCounter(input: {
    objectType: string;
    objectId: string;
    counterName: CounterName;
    delta?: number;
  }): Promise<CounterProjection>;

  getCounter(input: {
    objectType: string;
    objectId: string;
    counterName: CounterName;
  }): Promise<CounterProjection | null>;
};
