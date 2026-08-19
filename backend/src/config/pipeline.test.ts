import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  adaptiveFrameCount,
  buildCacheKey,
  resetPipelineConfigCache,
  uniformTimestampsMs,
} from '../config/pipelineConfig';
import { ContextBuilder } from '../context/ContextBuilder';
import { ProductRanker } from '../products/ProductRanker';
import { ProductValidator } from '../products/ProductValidator';
import { buildReasonerUserPayload } from '../prompts/productReasoner';
import { stagePass } from '../stages/gate';
import type { MultimodalContext, ProductCandidate } from '../domain/types';

beforeEach(() => {
  resetPipelineConfigCache();
  process.env.PIPELINE_VERSION = 'v5-test';
  process.env.PROVIDER_VERSION = 'prov-test';
  process.env.REVIEW_MIN_CONFIDENCE = '0.60';
  process.env.STAGE_PASS_CONFIDENCE = '0.60';
  process.env.MIN_PRODUCTS = '1';
  resetPipelineConfigCache();
});

describe('adaptiveFrameCount', () => {
  it('returns banded counts', () => {
    assert.equal(adaptiveFrameCount(5), 3);
    assert.equal(adaptiveFrameCount(20), 3);
    assert.equal(adaptiveFrameCount(45), 5);
    assert.equal(adaptiveFrameCount(120), 8);
  });
});

describe('uniformTimestampsMs', () => {
  it('spreads frames across duration', () => {
    const ts = uniformTimestampsMs(10_000, 3);
    assert.equal(ts.length, 3);
    assert.ok(ts[0]! < ts[1]! && ts[1]! < ts[2]!);
    assert.ok(ts[0]! > 0 && ts[2]! < 10_000);
  });
});

describe('buildCacheKey', () => {
  it('includes pipeline and provider versions', () => {
    const key = buildCacheKey({ platform: 'youtube', externalVideoId: 'abc123' });
    assert.equal(key, 'youtube:abc123:v5-test:prov-test:youtube-metadata-v2');
  });
});

describe('stagePass', () => {
  it('fails on empty', () => {
    assert.equal(stagePass([]).pass, false);
  });
  it('passes when confidence and count ok', () => {
    const r = stagePass([{ name: 'Bike', category: 'sports', brand: null, model: null, confidence: 0.9, evidence: 'x', sources: ['VISION'] }]);
    assert.equal(r.pass, true);
  });
});

describe('ProductValidator', () => {
  it('drops low confidence and duplicates', () => {
    const v = new ProductValidator();
    const out = v.validate([
      { name: 'Road Bicycle', category: 'sports', brand: null, model: null, confidence: 0.3, evidence: 'weak', sources: ['VISION'] },
      { name: 'Road Bicycle', category: 'sports', brand: null, model: null, confidence: 0.9, evidence: 'strong', sources: ['VISION'] },
      { name: 'Road Bicycle', category: 'sports', brand: null, model: null, confidence: 0.88, evidence: 'dup', sources: ['VISION'] },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.confidence, 0.9);
  });
});

describe('ProductRanker', () => {
  it('orders by score', () => {
    const ctx: MultimodalContext = {
      platform: 'youtube',
      externalVideoId: 'x',
      sourceUrl: 'https://youtube.com/watch?v=x',
      metadata: { title: 'ride' },
      transcript: { text: '', length: 0, available: false },
      media: {
        objects: [],
        logos: [],
        scene: { label: 'Cycling', confidence: 0.9 },
        activities: [],
        ocr: [],
        frames: [],
        providerMeta: {},
      },
      frames: [],
      pipelineVersion: 'v5-test',
      providerVersion: 'prov-test',
    };
    const products: ProductCandidate[] = [
      {
        name: 'Water Bottle',
        category: 'sports',
        brand: null,
        model: null,
        confidence: 0.65,
        evidence: { summary: 'a', frames: [], frameCount: 1, logoHits: [], transcriptMentions: false, ocrMentions: false },
        sources: ['VISION'],
      },
      {
        name: 'Road Bicycle',
        category: 'sports',
        brand: null,
        model: null,
        confidence: 0.95,
        evidence: {
          summary: 'dominant',
          frames: [{ frameIndex: 0, timestampMs: 1000 }],
          frameCount: 3,
          logoHits: [],
          transcriptMentions: false,
          ocrMentions: false,
        },
        sources: ['VISION', 'SCENE'],
      },
    ];
    const ranked = new ProductRanker().rank(products, ctx);
    assert.equal(ranked[0]!.name, 'Road Bicycle');
    assert.equal(ranked[0]!.sortOrder, 0);
  });
});

describe('ContextBuilder', () => {
  it('marks transcript availability from length', () => {
    process.env.TRANSCRIPT_MIN_CHARS = '40';
    resetPipelineConfigCache();
    const b = new ContextBuilder();
    const short = b.build({
      platform: 'youtube',
      externalVideoId: 'v',
      sourceUrl: 'https://youtu.be/v',
      metadata: {
        title: 'iPhone 17 Pro',
        description: 'A complete video description',
        creator: 'Tech Channel',
        thumbnailUrl: 'https://img.example/video.jpg',
      },
      transcriptText: 'hi',
      media: null,
    });
    assert.equal(short.transcript.available, false);
    assert.equal(short.metadata.description, 'A complete video description');
    const payload = buildReasonerUserPayload(JSON.stringify(short));
    assert.match(payload, /iPhone 17 Pro/);
    assert.match(payload, /A complete video description/);
    assert.match(payload, /Tech Channel/);
    assert.match(payload, /https:\/\/img\.example\/video\.jpg/);
    assert.match(payload, /"text":"hi"/);
    const long = b.build({
      platform: 'youtube',
      externalVideoId: 'v',
      sourceUrl: 'https://youtu.be/v',
      metadata: { title: 't' },
      transcriptText: 'x'.repeat(50),
      media: null,
    });
    assert.equal(long.transcript.available, true);
  });
});

describe('needsStage2Enrichment', () => {
  it('never runs stage 2 when stage 1 passes', async () => {
    const { needsStage2Enrichment } = await import('../stages/gate');
    assert.equal(
      needsStage2Enrichment({
        stage1Pass: true,
        transcriptAvailable: false,
        transcriptLength: 0,
      }),
      false,
    );
  });
});

describe('mergeMediaUnderstanding', () => {
  it('concatenates incremental facts', async () => {
    const { mergeMediaUnderstanding } = await import('../media/mergeMediaUnderstanding');
    const prior = {
      objects: [{ label: 'bike', confidence: 0.9, frameIndex: 0, timestampMs: 100 }],
      logos: [],
      scene: { label: 'Cycling', confidence: 0.8 },
      activities: [],
      ocr: [],
      frames: [{ index: 0, timestampMs: 100, storagePath: '/a.jpg' }],
      providerMeta: { vision: 'openai' },
    };
    const next = {
      objects: [{ label: 'helmet', confidence: 0.7, frameIndex: 1, timestampMs: 500 }],
      logos: [{ description: 'BrandX', confidence: 0.9, frameIndex: 1, timestampMs: 500 }],
      scene: { label: 'Cycling', confidence: 0.95 },
      activities: [],
      ocr: [],
      frames: [{ index: 1, timestampMs: 500, storagePath: '/b.jpg' }],
      providerMeta: { ocr: 'gcp' },
    };
    const merged = mergeMediaUnderstanding(prior, next);
    assert.equal(merged.objects.length, 2);
    assert.equal(merged.logos.length, 1);
    assert.equal(merged.scene.confidence, 0.95);
    assert.equal(merged.frames.length, 2);
  });
});
