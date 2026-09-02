import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ClaimGenerationResult,
  MarkFailedInput,
  MarkRefreshFailedInput,
  MarkUnavailableInput,
  ProductAiReviewRepository,
  UpsertReadyInput,
} from './ProductAiReviewRepository';
import type { ProductAiReviewPoint, ProductAiReviewRecord, ProductAiReviewSource } from './domain/types';
import { isGeneratingStale } from './domain/freshness';

type Row = Record<string, unknown>;

function mapPoint(raw: unknown): ProductAiReviewPoint {
  if (!raw || typeof raw !== 'object') return { text: '', evidence: [] };
  const text = typeof (raw as { text?: unknown }).text === 'string' ? (raw as { text: string }).text : '';
  const evidenceRaw = (raw as { evidence?: unknown }).evidence;
  const evidence: ProductAiReviewPoint['evidence'] = [];
  if (Array.isArray(evidenceRaw)) {
    for (const row of evidenceRaw) {
      if (!row || typeof row !== 'object') continue;
      const sourceId =
        typeof (row as { sourceId?: unknown }).sourceId === 'string'
          ? (row as { sourceId: string }).sourceId
          : '';
      const claim =
        typeof (row as { claim?: unknown }).claim === 'string' ? (row as { claim: string }).claim : '';
      if (sourceId && claim) evidence.push({ sourceId, claim });
    }
  }
  return { text, evidence };
}

function mapSource(raw: unknown): ProductAiReviewSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : '';
  const title = typeof (raw as { title?: unknown }).title === 'string' ? (raw as { title: string }).title : '';
  const url = typeof (raw as { url?: unknown }).url === 'string' ? (raw as { url: string }).url : '';
  const domain =
    typeof (raw as { domain?: unknown }).domain === 'string' ? (raw as { domain: string }).domain : '';
  if (!id || !title || !url) return null;
  const publishedAt =
    (raw as { publishedAt?: unknown }).publishedAt === null
      ? null
      : typeof (raw as { publishedAt?: unknown }).publishedAt === 'string'
        ? (raw as { publishedAt: string }).publishedAt
        : null;
  return { id, title, url, domain: domain || url, publishedAt };
}

function mapRow(row: Row): ProductAiReviewRecord {
  const prosRaw = row.pros;
  const consRaw = row.cons;
  const sourcesRaw = row.sources;
  return {
    id: String(row.id),
    productId: String(row.product_id),
    status: String(row.status) as ProductAiReviewRecord['status'],
    summary: (row.summary as string) ?? null,
    pros: Array.isArray(prosRaw) ? prosRaw.map(mapPoint) : [],
    cons: Array.isArray(consRaw) ? consRaw.map(mapPoint) : [],
    sources: Array.isArray(sourcesRaw)
      ? sourcesRaw.map(mapSource).filter((s): s is ProductAiReviewSource => s != null)
      : [],
    evidenceLastCheckedAt: (row.evidence_last_checked_at as string) ?? null,
    summaryGeneratedAt: (row.summary_generated_at as string) ?? null,
    evidenceHash: (row.evidence_hash as string) ?? null,
    model: (row.model as string) ?? null,
    errorCode: (row.error_code as string) ?? null,
    errorMessage: (row.error_message as string) ?? null,
    refreshErrorCode: (row.refresh_error_code as string) ?? null,
    refreshFailedAt: (row.refresh_failed_at as string) ?? null,
    refreshNextRetryAt: (row.refresh_next_retry_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SupabaseProductAiReviewRepository implements ProductAiReviewRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async findByProductId(productId: string): Promise<ProductAiReviewRecord | null> {
    const { data, error } = await this.admin
      .from('product_ai_reviews')
      .select('*')
      .eq('product_id', productId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapRow(data as Row) : null;
  }

  async claimGeneration(
    productId: string,
    evidenceHash: string,
    model: string,
  ): Promise<ClaimGenerationResult> {
    const existing = await this.findByProductId(productId);
    const ts = new Date().toISOString();

    if (!existing) {
      const { data, error } = await this.admin
        .from('product_ai_reviews')
        .insert({
          product_id: productId,
          status: 'GENERATING',
          evidence_hash: evidenceHash,
          model,
          updated_at: ts,
        })
        .select('*')
        .single();
      if (error) {
        if (error.code === '23505') {
          const raced = await this.findByProductId(productId);
          return { claimed: false, record: raced };
        }
        throw new Error(error.message);
      }
      return { claimed: true, record: mapRow(data as Row) };
    }

    if (existing.status === 'GENERATING' && !isGeneratingStale(existing.updatedAt)) {
      return { claimed: false, record: existing };
    }

    const { data, error } = await this.admin
      .from('product_ai_reviews')
      .update({
        status: 'GENERATING',
        evidence_hash: evidenceHash,
        model,
        error_code: null,
        error_message: null,
        updated_at: ts,
      })
      .eq('product_id', productId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return { claimed: true, record: mapRow(data as Row) };
  }

  async markReady(input: UpsertReadyInput): Promise<ProductAiReviewRecord> {
    const ts = new Date().toISOString();
    const { data, error } = await this.admin
      .from('product_ai_reviews')
      .upsert(
        {
          product_id: input.productId,
          status: 'READY',
          summary: input.summary,
          pros: input.pros,
          cons: input.cons,
          sources: input.sources,
          evidence_last_checked_at: input.evidenceLastCheckedAt,
          summary_generated_at: input.summaryGeneratedAt,
          evidence_hash: input.evidenceHash,
          model: input.model,
          error_code: null,
          error_message: null,
          refresh_error_code: null,
          refresh_failed_at: null,
          refresh_next_retry_at: null,
          updated_at: ts,
        },
        { onConflict: 'product_id' },
      )
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return mapRow(data as Row);
  }

  async markUnavailable(input: MarkUnavailableInput): Promise<ProductAiReviewRecord> {
    const ts = new Date().toISOString();
    const { data, error } = await this.admin
      .from('product_ai_reviews')
      .upsert(
        {
          product_id: input.productId,
          status: 'UNAVAILABLE',
          evidence_hash: input.evidenceHash,
          evidence_last_checked_at: input.evidenceLastCheckedAt,
          error_code: input.errorCode,
          error_message: input.errorMessage,
          updated_at: ts,
        },
        { onConflict: 'product_id' },
      )
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return mapRow(data as Row);
  }

  async markRefreshFailed(input: MarkRefreshFailedInput): Promise<ProductAiReviewRecord> {
    const ts = new Date().toISOString();
    const { data, error } = await this.admin
      .from('product_ai_reviews')
      .update({
        refresh_error_code: input.refreshErrorCode,
        refresh_failed_at: input.refreshFailedAt,
        refresh_next_retry_at: input.refreshNextRetryAt,
        updated_at: ts,
      })
      .eq('product_id', input.productId)
      .eq('status', 'READY')
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return mapRow(data as Row);
  }

  async markFailed(input: MarkFailedInput): Promise<ProductAiReviewRecord> {
    const ts = new Date().toISOString();
    const { data, error } = await this.admin
      .from('product_ai_reviews')
      .upsert(
        {
          product_id: input.productId,
          status: 'FAILED',
          error_code: input.errorCode,
          error_message: input.errorMessage,
          updated_at: ts,
        },
        { onConflict: 'product_id' },
      )
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return mapRow(data as Row);
  }
}
