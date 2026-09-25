import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentSourceRepository } from './ContentSourceRepository';
import { ENQUEUEABLE_STATUSES, PROCESSING_CLAIM_STATUSES, REPROCESSABLE_STATUSES } from './domain/lifecycle';
import type {
  ContentExtractionMethod,
  ContentMediaKind,
  ContentProcessingStatus,
  ContentSourceIdentity,
  ContentSourcePlatform,
  ContentSourceProductRecord,
  ContentSourceRecord,
  InsertContentSourceProductRow,
  InsertContentSourceRow,
} from './domain/types';

type ContentSourceRow = {
  id: string;
  platform: string;
  external_id: string;
  canonical_url: string;
  media_kind: string;
  processing_status: string;
  pipeline_version: string;
  queued_at: string | null;
  last_processed_at: string | null;
  candidate_count: number | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  schema_version: number;
};

function mapRow(row: ContentSourceRow): ContentSourceRecord {
  return {
    id: row.id,
    platform: row.platform as ContentSourcePlatform,
    externalId: row.external_id,
    canonicalUrl: row.canonical_url,
    mediaKind: row.media_kind as ContentMediaKind,
    processingStatus: row.processing_status as ContentProcessingStatus,
    pipelineVersion: row.pipeline_version,
    queuedAt: row.queued_at,
    lastProcessedAt: row.last_processed_at,
    candidateCount: row.candidate_count ?? 0,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schemaVersion: row.schema_version,
  };
}

export class SupabaseContentSourceRepository implements ContentSourceRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async findById(id: string): Promise<ContentSourceRecord | null> {
    const { data, error } = await this.admin
      .from('content_sources')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as ContentSourceRow) : null;
  }

  async findByIdentity(
    identity: Pick<ContentSourceIdentity, 'platform' | 'externalId'>,
  ): Promise<ContentSourceRecord | null> {
    const { data, error } = await this.admin
      .from('content_sources')
      .select('*')
      .eq('platform', identity.platform)
      .eq('external_id', identity.externalId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as ContentSourceRow) : null;
  }

  async insert(row: InsertContentSourceRow): Promise<ContentSourceRecord> {
    const { data, error } = await this.admin
      .from('content_sources')
      .insert({
        platform: row.platform,
        external_id: row.externalId,
        canonical_url: row.canonicalUrl,
        media_kind: row.mediaKind,
        processing_status: row.processingStatus,
        pipeline_version: row.pipelineVersion,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data as ContentSourceRow);
  }

  /** Single conditional UPDATE — the status guard is evaluated by Postgres, not here. */
  async markQueued(id: string, queuedAt: string): Promise<ContentSourceRecord | null> {
    const { data, error } = await this.admin
      .from('content_sources')
      .update({
        processing_status: 'QUEUED',
        queued_at: queuedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('processing_status', [...ENQUEUEABLE_STATUSES])
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as ContentSourceRow) : null;
  }

  async markRequeue(id: string, queuedAt: string): Promise<ContentSourceRecord | null> {
    const { data, error } = await this.admin
      .from('content_sources')
      .update({
        processing_status: 'QUEUED',
        queued_at: queuedAt,
        failure_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('processing_status', [...REPROCESSABLE_STATUSES])
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as ContentSourceRow) : null;
  }

  async markRevertToReceived(id: string): Promise<ContentSourceRecord | null> {
    const { data, error } = await this.admin
      .from('content_sources')
      .update({
        processing_status: 'RECEIVED',
        queued_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('processing_status', 'QUEUED')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as ContentSourceRow) : null;
  }

  async markProcessing(id: string): Promise<ContentSourceRecord | null> {
    const { data, error } = await this.admin
      .from('content_sources')
      .update({
        processing_status: 'PROCESSING',
        failure_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('processing_status', [...PROCESSING_CLAIM_STATUSES])
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as ContentSourceRow) : null;
  }

  async markReady(
    id: string,
    params: { lastProcessedAt: string; candidateCount: number },
  ): Promise<ContentSourceRecord | null> {
    const { data, error } = await this.admin
      .from('content_sources')
      .update({
        processing_status: 'READY',
        last_processed_at: params.lastProcessedAt,
        candidate_count: params.candidateCount,
        failure_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('processing_status', 'PROCESSING')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as ContentSourceRow) : null;
  }

  async markFailed(
    id: string,
    params: { lastProcessedAt: string; reason: string },
  ): Promise<ContentSourceRecord | null> {
    const { data, error } = await this.admin
      .from('content_sources')
      .update({
        processing_status: 'FAILED',
        last_processed_at: params.lastProcessedAt,
        failure_reason: params.reason.slice(0, 200),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .in('processing_status', ['QUEUED', 'PROCESSING'])
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as ContentSourceRow) : null;
  }

  async replaceProducts(
    contentSourceId: string,
    rows: InsertContentSourceProductRow[],
  ): Promise<ContentSourceProductRecord[]> {
    const { error: delErr } = await this.admin
      .from('content_source_products')
      .delete()
      .eq('content_source_id', contentSourceId);
    if (delErr) throw delErr;
    if (rows.length === 0) return [];

    const { data, error } = await this.admin
      .from('content_source_products')
      .insert(
        rows.map((row) => ({
          content_source_id: contentSourceId,
          position: row.position,
          external_id: row.externalId,
          name: row.name,
          brand: row.brand,
          model: row.model,
          category: row.category,
          price: row.price,
          currency: row.currency,
          image: row.image,
          merchant_url: row.merchantUrl,
          confidence: row.confidence,
          extraction_method: row.extractionMethod,
          sources: row.sources,
          evidence: row.evidence,
          processor_version: row.processorVersion,
          catalog_product_id: row.catalogProductId ?? null,
          discovered_product_id: row.discoveredProductId ?? null,
        })),
      )
      .select('*');
    if (error) throw error;
    return ((data ?? []) as ContentSourceProductRow[]).map(mapProductRow);
  }

  async listProducts(contentSourceId: string): Promise<ContentSourceProductRecord[]> {
    const { data, error } = await this.admin
      .from('content_source_products')
      .select('*')
      .eq('content_source_id', contentSourceId)
      .order('position', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as ContentSourceProductRow[]).map(mapProductRow);
  }

  async bindProductResolution(
    productId: string,
    bind: { catalogProductId: string | null; discoveredProductId: string | null },
  ): Promise<ContentSourceProductRecord | null> {
    const { data, error } = await this.admin
      .from('content_source_products')
      .update({
        catalog_product_id: bind.catalogProductId,
        discovered_product_id: bind.discoveredProductId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ? mapProductRow(data as ContentSourceProductRow) : null;
  }

  async listBoundSourceIds(bind: {
    catalogProductId?: string | null;
    discoveredProductId?: string | null;
  }): Promise<string[]> {
    const catalogId = bind.catalogProductId?.trim() || null;
    const discoveredId = bind.discoveredProductId?.trim() || null;
    const ids = new Set<string>();
    if (catalogId) {
      const { data, error } = await this.admin
        .from('content_source_products')
        .select('content_source_id')
        .eq('catalog_product_id', catalogId);
      if (error) throw error;
      for (const row of data ?? []) {
        if (typeof row.content_source_id === 'string') ids.add(row.content_source_id);
      }
    }
    if (discoveredId) {
      const { data, error } = await this.admin
        .from('content_source_products')
        .select('content_source_id')
        .eq('discovered_product_id', discoveredId);
      if (error) throw error;
      for (const row of data ?? []) {
        if (typeof row.content_source_id === 'string') ids.add(row.content_source_id);
      }
    }
    return [...ids];
  }
}

type ContentSourceProductRow = {
  id: string;
  content_source_id: string;
  position: number;
  external_id: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  price: string | null;
  currency: string | null;
  image: string | null;
  merchant_url: string | null;
  confidence: number | null;
  extraction_method: string;
  sources: unknown;
  evidence: unknown;
  processor_version: string;
  catalog_product_id: string | null;
  discovered_product_id: string | null;
  created_at: string;
  updated_at: string;
  schema_version: number;
};

function mapProductRow(row: ContentSourceProductRow): ContentSourceProductRecord {
  return {
    id: row.id,
    contentSourceId: row.content_source_id,
    position: row.position,
    externalId: row.external_id,
    name: row.name,
    brand: row.brand,
    model: row.model,
    category: row.category,
    price: row.price,
    currency: row.currency,
    image: row.image,
    merchantUrl: row.merchant_url,
    confidence: row.confidence,
    extractionMethod: row.extraction_method as ContentExtractionMethod,
    sources: Array.isArray(row.sources) ? row.sources.filter((s): s is string => typeof s === 'string') : [],
    evidence:
      row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : {},
    processorVersion: row.processor_version,
    catalogProductId: row.catalog_product_id ?? null,
    discoveredProductId: row.discovered_product_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schemaVersion: row.schema_version,
  };
}
