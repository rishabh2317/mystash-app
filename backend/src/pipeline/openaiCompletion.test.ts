import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import type { MultimodalContext } from '../domain/types';
import { getPipelineConfig, resetPipelineConfigCache, buildCacheKey } from '../config/pipelineConfig';
import { OpenAiVisionProvider, FIND_VISUAL_FACTS_SYSTEM } from '../providers/vision/OpenAiVisionProvider';
import { OpenAiSceneProvider } from '../providers/scene/OpenAiSceneProvider';
import { OpenAiReasonerProvider } from '../providers/reasoner/OpenAiReasonerProvider';
import { PRODUCT_REASONER_SYSTEM, FIND_VIDEO_REASONER_SYSTEM } from '../prompts/productReasoner';
import { logger } from '../logger';
import { privateImageContext, privateImageLogFields } from '../user-import/media/privacy';
import { estimateTokenCostUsd } from '../services/stageArtifacts';
import { defaultOpenAiModel } from './openaiClient';
import { previewProductLink, clearLiveProductPreviewMemoForTests } from './productLinkPreview';
import { activeChatParameters, recordOpenAiCompletion } from './openaiCompletion';

const envKeys = ['OPENAI_API_KEY','TAVILY_API_KEY','OPENAI_MODEL','OPENAI_REASONER_MODEL','OPENAI_VISION_MODEL','OPENAI_MERCHANT_MODEL','PROVIDER_VERSION'];
const saved = new Map(envKeys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const requests: Record<string, unknown>[] = [];
const logs: Record<string, unknown>[] = [];
let payload: unknown;
let finishReason = 'stop';
const usage = { prompt_tokens: 110, completion_tokens: 45, total_tokens: 155,
  prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 12 } };
const expectedUsage = { promptTokens: 110, completionTokens: 45, totalTokens: 155, reasoningTokens: 12, cachedTokens: 20 };
const ctx = { ingestId: 'opaque-source', traceId: 'opaque-trace' };
const frames = [{ index: 0, timestampMs: 100, storagePath: '', base64Jpeg: 'fixture-image-bytes' }];
const context: MultimodalContext = { platform: 'youtube', externalVideoId: 'fixture', sourceUrl: 'https://youtu.be/fixture',
  metadata: { title: 'Private content canary' }, transcript: { text: '', available: false, length: 0 },
  media: null, frames: [], pipelineVersion: 'fixture', providerVersion: 'fixture' };
const db = { from: () => {
  const builder: Record<string, unknown> = {};
  for (const key of ['select','eq','update','upsert']) builder[key] = () => builder;
  builder.maybeSingle = async () => ({ data: null, error: null });
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
  return builder;
} } as unknown as SupabaseClient;

beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  process.env.OPENAI_API_KEY = 'fixture-not-a-real-key';
  process.env.OPENAI_MODEL = 'gpt-4o-mini'; // Existing local config must not defeat the active upgrade.
  resetPipelineConfigCache(); clearLiveProductPreviewMemoForTests(); requests.length = 0; logs.length = 0; finishReason = 'stop';
  mock.method(logger, 'info', (fields: Record<string, unknown>) => { logs.push(fields); });
  mock.method(logger, 'warn', () => {});
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, 'https://api.openai.com/v1/chat/completions', 'no new endpoint or external requests');
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return Response.json({ id: 'fixture', object: 'chat.completion', model: 'gpt-6-luna-2026-11-01',
      choices: [{ index: 0, message: { role: 'assistant', content: typeof payload === 'string' ? payload : JSON.stringify(payload) }, finish_reason: finishReason }], usage });
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch; mock.restoreAll(); resetPipelineConfigCache(); clearLiveProductPreviewMemoForTests();
  for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

function assertLuna(limit: number) {
  assert.equal(requests.length, 1, 'one existing model call only');
  const body = requests[0];
  assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_completion_tokens, limit); assert.deepEqual(body.response_format, { type: 'json_object' });
  for (const key of ['temperature','max_tokens','tools','tool_choice','top_p']) assert.equal(key in body, false, key);
  const event = logs.find(row => row.event === 'openai.usage'); assert.ok(event);
  assert.equal(event.model, 'gpt-6-luna-2026-11-01'); assert.equal(event.requestedModel, 'gpt-6-luna');
  for (const [key, value] of Object.entries(expectedUsage)) assert.equal(event[key], value);
  assert.doesNotMatch(JSON.stringify(event), /Private content canary|fixture-image-bytes|youtu\.be|fixture-not-a-real-key/);
  return body;
}

test('active models default to Luna; legacy default remains mini; explicit overrides remain usable', () => {
  const cfg = getPipelineConfig();
  assert.equal(cfg.openaiReasonerModel, 'gpt-6-luna'); assert.equal(cfg.openaiVisionModel, 'gpt-6-luna'); assert.equal(cfg.openaiMerchantModel, 'gpt-6-luna');
  assert.equal(defaultOpenAiModel(), 'gpt-4o-mini');
  const lunaKey = buildCacheKey({ platform: 'youtube', externalVideoId: 'fixture' });
  process.env.OPENAI_REASONER_MODEL = 'gpt-4o-mini'; process.env.OPENAI_VISION_MODEL = 'gpt-4o-mini'; process.env.OPENAI_MERCHANT_MODEL = ' gpt-4o-mini ';
  resetPipelineConfigCache();
  assert.equal(getPipelineConfig().openaiMerchantModel, 'gpt-4o-mini');
  assert.notEqual(buildCacheKey({ platform: 'youtube', externalVideoId: 'fixture' }), lunaKey);
  assert.deepEqual(activeChatParameters('gpt-4o-mini', 600, 0.1), { temperature: 0.1, max_tokens: 600 });
  assert.deepEqual(activeChatParameters('gpt-6-luna-2026-11-01', 600, 0.1), { reasoning_effort: 'low', max_completion_tokens: 600 });
});

test('object vision preserves Find attributes, image detail, JSON output and token limit', async () => {
  payload = { objects: [{ label: 'mini dress', confidence: 0.9, frameIndex: 0, attributes: { colour: 'black' } }] };
  const result = await new OpenAiVisionProvider(db, true).detectObjects({ ...ctx, frames });
  assert.equal(result.objects[0].attributes?.colour, 'black'); assert.deepEqual(result.meta.tokenUsage, expectedUsage);
  const body = assertLuna(2000); const messages = body.messages as { content: unknown }[];
  assert.equal(messages[0].content, FIND_VISUAL_FACTS_SYSTEM);
  assert.deepEqual((messages[1].content as unknown[])[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,fixture-image-bytes', detail: 'low' } });
});

test('generic image/Create vision prompt remains generic', async () => {
  payload = { objects: [] }; await new OpenAiVisionProvider(db).detectObjects({ ...ctx, frames });
  const body = assertLuna(2000);
  assert.match((body.messages as { content: string }[])[0].content, /Labels are generic nouns/);
});

test('scene classification retains output parsing and now returns actual model and full usage', async () => {
  payload = { scene: { label: 'Street Fashion', confidence: 0.8 }, activities: [] };
  const result = await new OpenAiSceneProvider(db).classify({ ...ctx, frames });
  assert.equal(result.scene.label, 'Street Fashion'); assert.equal(result.meta.model, 'gpt-6-luna-2026-11-01');
  assert.deepEqual(result.meta.tokenUsage, expectedUsage); assertLuna(800);
});

for (const kind of ['creator','find','image'] as const) test(`${kind} reasoning keeps the original prompt and product/place contract`, async () => {
  payload = { products: [{ name: 'Black mini dress', confidence: 0.8, sources: ['VISION'] }], places: [{ name: 'Cubbon Park', confidence: 0.9, entityKind: 'venue', sources: ['METADATA'] }] };
  const result = await new OpenAiReasonerProvider(db).reason({ ...ctx, context, includePlaces: kind !== 'creator', ...(kind === 'image' ? { inputKind: 'image' as const } : {}) });
  const body = assertLuna(4096); const messages = body.messages as { content: string }[];
  if (kind === 'creator') { assert.equal(messages[0].content, PRODUCT_REASONER_SYSTEM); assert.equal(result.places, undefined); }
  else if (kind === 'find') assert.equal(messages[0].content, FIND_VIDEO_REASONER_SYSTEM);
  else assert.match(messages[0].content, /ONE PRIVATE STILL IMAGE/);
  assert.equal(result.products[0].name, 'Black mini dress'); assert.deepEqual(result.meta.tokenUsage, expectedUsage);
});

test('merchant fallback uses its configured Luna model once and preserves currency/evidence rules', async () => {
  process.env.TAVILY_API_KEY = 'fixture';
  const merchantUrl = 'https://shop.example/product/black-mini-dress';
  payload = { name: 'Black mini dress', brand: null, price: 'USD 49', currency: 'USD', imageUrl: 'https://shop.example/dress.jpg', description: 'Black mini dress' };
  const openaiFetch = globalThis.fetch;
  mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('api.openai.com')) return openaiFetch(input, init);
    if (url.includes('api.tavily.com')) return Response.json({ results: [{ url: merchantUrl, raw_content: 'Black mini dress. USD 49. Buy now.', images: [] }] });
    assert.equal(url, merchantUrl); return new Response('', { status: 503 });
  };
  const result = await previewProductLink(db, merchantUrl, ctx);
  const body = assertLuna(600);
  assert.match((body.messages as { content: string }[])[0].content, /never guess, convert, or localize a price/);
  assert.equal(result.merchantUrl, merchantUrl); assert.equal(result.currency, 'USD');
});

test('explicit mini comparison override keeps supported sampling parameters on the actual request', async () => {
  process.env.OPENAI_REASONER_MODEL = 'gpt-4o-mini'; resetPipelineConfigCache(); payload = { products: [] };
  await new OpenAiReasonerProvider(db).reason({ ...ctx, context });
  assert.equal(requests.length, 1); assert.equal(requests[0].model, 'gpt-4o-mini'); assert.equal(requests[0].temperature, 0.2);
  assert.equal(requests[0].max_tokens, 4096); assert.equal('reasoning_effort' in requests[0], false);
});

test('empty frames remain free of calls; truncated JSON keeps the existing parse fallback and records length', async () => {
  await new OpenAiVisionProvider(db).detectObjects({ ...ctx, frames: [] }); await new OpenAiSceneProvider(db).classify({ ...ctx, frames: [] });
  assert.equal(requests.length, 0); payload = '{"scene":'; finishReason = 'length';
  const result = await new OpenAiSceneProvider(db).classify({ ...ctx, frames });
  assert.equal(result.scene.label, 'unknown'); assertLuna(800);
  assert.equal(logs.find(row => row.event === 'openai.usage')?.finishReason, 'length');
});

test('unsupported request errors remain errors without a new model fallback or repair call', async () => {
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ error: { message: 'Unsupported parameter fixture', type: 'invalid_request_error' } }, { status: 400 });
  };
  await assert.rejects(new OpenAiReasonerProvider(db).reason({ ...ctx, context }), /400/);
  assert.equal(requests.length, 1); assert.equal(logs.some(row => row.event === 'openai.usage'), false);
});

test('missing usage is unknown, not fabricated; private-image telemetry exposes only operational facts', () => {
  const minimal = { model: 'gpt-6-luna', choices: [] } as unknown as ChatCompletion;
  const absent = recordOpenAiCompletion(ctx, 'reasoner', 'gpt-6-luna', minimal, 5);
  assert.equal(absent.reasoningTokens, undefined); assert.equal(absent.promptTokens, undefined);
  const safe = privateImageContext.run(true, () => privateImageLogFields({ ...logs[0], prompt: 'PRIVATE', url: 'SECRET', text: 'PRIVATE', modelName: 'PRIVATE' }));
  assert.equal(safe.model, 'gpt-6-luna'); assert.equal(safe.integration, 'reasoner'); assert.doesNotMatch(JSON.stringify(safe), /PRIVATE|SECRET/);
  const other = privateImageContext.run(true, () => privateImageLogFields({ event: 'unrelated', model: 'gpt-6-luna', promptTokens: 100 }));
  assert.deepEqual(other, { event: 'unrelated' });
  assert.equal(estimateTokenCostUsd(1000, 'gpt-6-luna'), null, 'do not mislabel old mini blended price as Luna cost');
  assert.equal(estimateTokenCostUsd(1000, 'gpt-4o-mini'), 0.0003);
});
