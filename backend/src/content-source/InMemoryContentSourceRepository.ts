import { randomUUID } from 'node:crypto';
import type { ContentSourceRepository } from './ContentSourceRepository';
import { ENQUEUEABLE_STATUSES, PROCESSING_CLAIM_STATUSES } from './domain/lifecycle';
import type {
  ContentSourceIdentity,
  ContentSourceProductRecord,
  ContentSourceRecord,
  InsertContentSourceProductRow,
  InsertContentSourceRow,
} from './domain/types';

function now(): string {
  return new Date().toISOString();
}

export class InMemoryContentSourceRepository implements ContentSourceRepository {
  sources = new Map<string, ContentSourceRecord>(); // id → record
  products = new Map<string, ContentSourceProductRecord>(); // id → record

  private byIdentity = new Map<string, string>(); // platform|externalId → id

  private key(platform: string, externalId: string): string {
    return `${platform}|${externalId}`;
  }

  async findById(id: string): Promise<ContentSourceRecord | null> {
    const record = this.sources.get(id);
    return record ? { ...record } : null;
  }

  async findByIdentity(
    identity: Pick<ContentSourceIdentity, 'platform' | 'externalId'>,
  ): Promise<ContentSourceRecord | null> {
    const id = this.byIdentity.get(this.key(identity.platform, identity.externalId));
    if (!id) return null;
    const record = this.sources.get(id);
    return record ? { ...record } : null;
  }

  async insert(row: InsertContentSourceRow): Promise<ContentSourceRecord> {
    const key = this.key(row.platform, row.externalId);
    if (this.byIdentity.has(key)) {
      const err = new Error('duplicate content source') as Error & { code?: string };
      err.code = '23505';
      throw err;
    }
    const ts = now();
    const record: ContentSourceRecord = {
      id: randomUUID(),
      platform: row.platform,
      externalId: row.externalId,
      canonicalUrl: row.canonicalUrl,
      mediaKind: row.mediaKind,
      processingStatus: row.processingStatus,
      pipelineVersion: row.pipelineVersion,
      queuedAt: null,
      lastProcessedAt: null,
      candidateCount: 0,
      failureReason: null,
      createdAt: ts,
      updatedAt: ts,
      schemaVersion: 1,
    };
    this.sources.set(record.id, record);
    this.byIdentity.set(key, record.id);
    return { ...record };
  }

  async markQueued(id: string, queuedAt: string): Promise<ContentSourceRecord | null> {
    const record = this.sources.get(id);
    if (!record) return null;
    if (!ENQUEUEABLE_STATUSES.includes(record.processingStatus)) return null;
    const next: ContentSourceRecord = {
      ...record,
      processingStatus: 'QUEUED',
      queuedAt,
      updatedAt: now(),
    };
    this.sources.set(id, next);
    return { ...next };
  }

  async markProcessing(id: string): Promise<ContentSourceRecord | null> {
    const record = this.sources.get(id);
    if (!record) return null;
    if (!PROCESSING_CLAIM_STATUSES.includes(record.processingStatus)) return null;
    const next: ContentSourceRecord = {
      ...record,
      processingStatus: 'PROCESSING',
      failureReason: null,
      updatedAt: now(),
    };
    this.sources.set(id, next);
    return { ...next };
  }

  async markReady(
    id: string,
    params: { lastProcessedAt: string; candidateCount: number },
  ): Promise<ContentSourceRecord | null> {
    const record = this.sources.get(id);
    if (!record) return null;
    if (record.processingStatus !== 'PROCESSING') return null;
    const next: ContentSourceRecord = {
      ...record,
      processingStatus: 'READY',
      lastProcessedAt: params.lastProcessedAt,
      candidateCount: params.candidateCount,
      failureReason: null,
      updatedAt: now(),
    };
    this.sources.set(id, next);
    return { ...next };
  }

  async markFailed(
    id: string,
    params: { lastProcessedAt: string; reason: string },
  ): Promise<ContentSourceRecord | null> {
    const record = this.sources.get(id);
    if (!record) return null;
    if (record.processingStatus !== 'PROCESSING' && record.processingStatus !== 'QUEUED') {
      return null;
    }
    const next: ContentSourceRecord = {
      ...record,
      processingStatus: 'FAILED',
      lastProcessedAt: params.lastProcessedAt,
      failureReason: params.reason.slice(0, 200),
      updatedAt: now(),
    };
    this.sources.set(id, next);
    return { ...next };
  }

  async replaceProducts(
    contentSourceId: string,
    rows: InsertContentSourceProductRow[],
  ): Promise<ContentSourceProductRecord[]> {
    for (const [id, product] of [...this.products.entries()]) {
      if (product.contentSourceId === contentSourceId) this.products.delete(id);
    }
    const ts = now();
    const stored: ContentSourceProductRecord[] = [];
    for (const row of rows) {
      const record: ContentSourceProductRecord = {
        id: row.id ?? randomUUID(),
        contentSourceId,
        position: row.position,
        externalId: row.externalId,
        name: row.name,
        brand: row.brand,
        model: row.model,
        category: row.category,
        price: row.price,
        currency: row.currency,
        image: row.image,
        merchantUrl: row.merchantUrl,
        confidence: row.confidence,
        extractionMethod: row.extractionMethod,
        sources: [...row.sources],
        evidence: { ...row.evidence },
        processorVersion: row.processorVersion,
        catalogProductId: row.catalogProductId ?? null,
        discoveredProductId: row.discoveredProductId ?? null,
        createdAt: row.createdAt ?? ts,
        updatedAt: row.updatedAt ?? ts,
        schemaVersion: row.schemaVersion ?? 1,
      };
      this.products.set(record.id, record);
      stored.push({ ...record, sources: [...record.sources], evidence: { ...record.evidence } });
    }
    return stored.sort((a, b) => a.position - b.position);
  }

  async listProducts(contentSourceId: string): Promise<ContentSourceProductRecord[]> {
    return [...this.products.values()]
      .filter((p) => p.contentSourceId === contentSourceId)
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ ...p, sources: [...p.sources], evidence: { ...p.evidence } }));
  }

  async bindProductResolution(
    productId: string,
    bind: { catalogProductId: string | null; discoveredProductId: string | null },
  ): Promise<ContentSourceProductRecord | null> {
    const record = this.products.get(productId);
    if (!record) return null;
    const next: ContentSourceProductRecord = {
      ...record,
      catalogProductId: bind.catalogProductId,
      discoveredProductId: bind.discoveredProductId,
      updatedAt: now(),
    };
    this.products.set(productId, next);
    return { ...next, sources: [...next.sources], evidence: { ...next.evidence } };
  }

  async listBoundSourceIds(bind: {
    catalogProductId?: string | null;
    discoveredProductId?: string | null;
  }): Promise<string[]> {
    const catalogId = bind.catalogProductId?.trim() || null;
    const discoveredId = bind.discoveredProductId?.trim() || null;
    const ids = new Set<string>();
    for (const product of this.products.values()) {
      if (catalogId && product.catalogProductId === catalogId) ids.add(product.contentSourceId);
      if (discoveredId && product.discoveredProductId === discoveredId) {
        ids.add(product.contentSourceId);
      }
    }
    return [...ids];
  }
}
