import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductCandidate } from '../../domain/types';
import type { ContentSourceRecord } from '../domain/types';
import { ContentSourceTerminalError } from './errors';
import { createVideoExtractionAdapter } from './videoAdapter';
import type { ProgressiveExtractInput, ProgressiveExtractResult } from '../../stages/progressiveExtract';

function videoSource(partial: Partial<ContentSourceRecord> = {}): ContentSourceRecord {
  return {
    id: 'src-video-1',
    platform: 'youtube',
    externalId: 'dQw4w9WgXcQ',
    canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    mediaKind: 'VIDEO',
    processingStatus: 'PROCESSING',
    pipelineVersion: 'test',
    queuedAt: null,
    lastProcessedAt: null,
    candidateCount: 0,
    failureReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
    ...partial,
  };
}

describe('createVideoExtractionAdapter', () => {
  it('maps content source identity onto runProgressiveExtract and reuses a cache hit', async () => {
    const calls: ProgressiveExtractInput[] = [];
    const products: ProductCandidate[] = [
      {
        name: 'Sony WH-1000XM5',
        category: 'headphones',
        brand: 'Sony',
        model: 'WH-1000XM5',
        confidence: 0.9,
        evidence: 'metadata',
        sources: ['METADATA'],
      },
    ];
    const adapter = createVideoExtractionAdapter({} as SupabaseClient, async (input) => {
      calls.push(input);
      return {
        kind: 'ok',
        products,
        status: 'cached',
        finalStage: 'cache',
        cacheHit: true,
        metadata: {
          title: 'Review',
          description: '',
          descriptionSource: 'cache',
          creator: '',
          thumbnailUrl: null,
        },
        durationMs: 4,
      } satisfies ProgressiveExtractResult;
    });

    const result = await adapter.extract({
      contentSource: videoSource(),
      traceId: 't1',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.externalVideoId, 'dQw4w9WgXcQ');
    assert.equal(calls[0]?.platform, 'youtube');
    assert.equal(calls[0]?.correlationId, 'src-video-1');
    assert.equal(calls[0]?.sourceUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(result.cacheHit, true);
    assert.equal(result.extractionMethod, 'cache');
    assert.equal(result.products[0]?.name, 'Sony WH-1000XM5');
  });

  it('runs uncached extraction through the shared progressive helper', async () => {
    const adapter = createVideoExtractionAdapter({} as SupabaseClient, async () => ({
      kind: 'ok',
      products: [
        {
          name: 'A',
          category: 'x',
          brand: null,
          model: null,
          confidence: 0.5,
          evidence: '',
          sources: ['METADATA'],
        },
        {
          name: 'B',
          category: 'x',
          brand: null,
          model: null,
          confidence: 0.4,
          evidence: '',
          sources: ['TRANSCRIPT'],
        },
      ],
      status: 'ready_for_review',
      finalStage: 'stage1',
      cacheHit: false,
      metadata: {
        title: '',
        description: '',
        descriptionSource: 'none',
        creator: '',
        thumbnailUrl: null,
      },
      durationMs: 10,
    }));

    const result = await adapter.extract({ contentSource: videoSource(), traceId: 't1' });
    assert.equal(result.cacheHit, false);
    assert.equal(result.extractionMethod, 'ai_extract');
    assert.equal(result.products.length, 2);
    assert.equal(result.empty, false);
  });

  it('returns a successful empty result when the pipeline finds no products', async () => {
    const adapter = createVideoExtractionAdapter({} as SupabaseClient, async () => ({
      kind: 'ok',
      products: [],
      status: 'review_required',
      finalStage: 'stage1',
      cacheHit: false,
      metadata: {
        title: '',
        description: '',
        descriptionSource: 'none',
        creator: '',
        thumbnailUrl: null,
      },
      durationMs: 3,
    }));
    const result = await adapter.extract({ contentSource: videoSource(), traceId: 't1' });
    assert.equal(result.empty, true);
    assert.equal(result.products.length, 0);
  });

  it('treats source_unavailable as a terminal failure', async () => {
    const adapter = createVideoExtractionAdapter({} as SupabaseClient, async () => ({
      kind: 'source_unavailable',
      errorCode: 'SOURCE_UNAVAILABLE',
      errorMessage: 'This video is private',
      availability: 'restricted',
      title: null,
      durationMs: 2,
    }));
    await assert.rejects(
      () => adapter.extract({ contentSource: videoSource(), traceId: 't1' }),
      (err: unknown) =>
        err instanceof ContentSourceTerminalError && err.code === 'SOURCE_UNAVAILABLE',
    );
  });

  it('rejects a non-video identity instead of inventing a second extractor', async () => {
    const adapter = createVideoExtractionAdapter({} as SupabaseClient, async () => {
      throw new Error('extract should not run');
    });
    await assert.rejects(
      () =>
        adapter.extract({
          contentSource: videoSource({ mediaKind: 'WEB_PAGE', platform: 'web' }),
          traceId: 't1',
        }),
      (err: unknown) =>
        err instanceof ContentSourceTerminalError && err.code === 'MALFORMED_IDENTITY',
    );
  });
});
