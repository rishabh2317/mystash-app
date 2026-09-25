import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MultimodalContext } from '../domain/types';
import {
  buildReasonerTextSections,
  buildReasonerUserPayload,
} from './productReasoner';

function ctx(partial: Partial<MultimodalContext> & { metadata?: MultimodalContext['metadata'] }): MultimodalContext {
  return {
    platform: 'youtube',
    externalVideoId: 'abc',
    sourceUrl: 'https://youtu.be/abc',
    metadata: {
      title: 'My new phone',
      description: 'Testing this phone',
      ...partial.metadata,
    },
    transcript: {
      text: '',
      length: 0,
      available: false,
      ...partial.transcript,
    },
    media: null,
    frames: [],
    pipelineVersion: 'test',
    providerVersion: 'test',
    ...partial,
  };
}

describe('product reasoner text payload', () => {
  it('includes title and description when captions/transcript are missing', () => {
    const payload = buildReasonerUserPayload(ctx({}));
    assert.match(payload, /Title:\nMy new phone/);
    assert.match(payload, /Description:\nTesting this phone/);
    assert.match(payload, /Captions:\n\(none\)/);
    assert.match(payload, /Transcript:\n\(none\)/);
  });

  it('includes captions and transcript when available', () => {
    const spoken = "I've been using the Google Pixel 10 Pro XL for a week";
    const sections = buildReasonerTextSections(
      ctx({
        transcript: { text: spoken, length: spoken.length, available: true },
      }),
    );
    assert.match(sections, /Captions:\nI've been using the Google Pixel 10 Pro XL/);
    assert.match(sections, /Transcript:\nI've been using the Google Pixel 10 Pro XL/);
    const payload = buildReasonerUserPayload(
      ctx({
        transcript: { text: spoken, length: spoken.length, available: true },
      }),
    );
    assert.match(payload, /Title:\nMy new phone/);
    assert.match(payload, /Description:\nTesting this phone/);
    assert.match(payload, /Pixel 10 Pro XL/);
  });

  it('missing captions/transcript does not omit title or description', () => {
    const payload = buildReasonerUserPayload(
      ctx({
        metadata: { title: 'Only title', description: undefined },
        transcript: { text: '', length: 0, available: false },
      }),
    );
    assert.match(payload, /Title:\nOnly title/);
    assert.match(payload, /Description:\n\(none\)/);
    assert.match(payload, /Captions:\n\(none\)/);
    assert.match(payload, /Transcript:\n\(none\)/);
  });

  it('creator and user-import Stage 1 both use the shared reasoner payload helper', () => {
    const root = join(process.cwd(), 'src');
    const provider = readFileSync(join(root, 'providers/reasoner/OpenAiReasonerProvider.ts'), 'utf8');
    const orchestrator = readFileSync(join(root, 'stages/orchestrator.ts'), 'utf8');
    const progressive = readFileSync(join(root, 'stages/progressiveExtract.ts'), 'utf8');
    assert.match(provider, /buildReasonerUserPayload\(input\.context\)/);
    assert.match(orchestrator, /reasonValidateRank\([\s\S]*'s1'\)/);
    assert.match(progressive, /reasonValidateRank\([\s\S]*'s1'\)/);
    assert.match(orchestrator, /gatherYoutubeContext/);
    assert.match(progressive, /gatherYoutubeContext/);
  });
});
