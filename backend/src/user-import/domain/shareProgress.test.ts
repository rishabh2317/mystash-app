import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  USER_IMPORT_TIMEOUT_MS,
  resolveShareProgressState,
  shareProgressState,
  shouldPersistImportTimeout,
} from './shareProgress';

describe('shareProgressState', () => {
  it('maps processing statuses to user-facing states', () => {
    assert.equal(shareProgressState({ processingStatus: 'RECEIVED', candidateCount: 0 }), 'looking');
    assert.equal(shareProgressState({ processingStatus: 'QUEUED', candidateCount: 0 }), 'looking');
    assert.equal(shareProgressState({ processingStatus: 'PROCESSING', candidateCount: 0 }), 'looking');
    assert.equal(shareProgressState({ processingStatus: 'READY', candidateCount: 2 }), 'ready');
    assert.equal(shareProgressState({ processingStatus: 'READY', candidateCount: 0 }), 'nothing_yet');
    assert.equal(shareProgressState({ processingStatus: 'FAILED', candidateCount: 0 }), 'couldnt_finish');
    assert.equal(shareProgressState(null), 'looking');
  });
});

describe('resolveShareProgressState timeout', () => {
  const createdAt = '2026-09-22T10:00:00.000Z';
  const lookingSource = { processingStatus: 'PROCESSING' as const, candidateCount: 0 };

  it('keeps looking inside the 10 minute window', () => {
    const nowMs = Date.parse(createdAt) + USER_IMPORT_TIMEOUT_MS - 1;
    assert.equal(
      resolveShareProgressState({
        source: lookingSource,
        timedOutAt: null,
        createdAt,
        nowMs,
      }),
      'looking',
    );
  });

  it('forces couldnt_finish after 10 minutes while still looking', () => {
    const nowMs = Date.parse(createdAt) + USER_IMPORT_TIMEOUT_MS;
    assert.equal(
      resolveShareProgressState({
        source: lookingSource,
        timedOutAt: null,
        createdAt,
        nowMs,
      }),
      'couldnt_finish',
    );
    assert.equal(
      shouldPersistImportTimeout({
        source: lookingSource,
        timedOutAt: null,
        createdAt,
        nowMs,
      }),
      true,
    );
  });

  it('timedOutAt freezes UX even when the source later becomes READY', () => {
    assert.equal(
      resolveShareProgressState({
        source: { processingStatus: 'READY', candidateCount: 3 },
        timedOutAt: '2026-09-22T10:10:00.000Z',
        createdAt,
        nowMs: Date.parse(createdAt) + USER_IMPORT_TIMEOUT_MS + 60_000,
      }),
      'couldnt_finish',
    );
  });

  it('does not age out terminal READY / NOTHING_YET / FAILED', () => {
    const nowMs = Date.parse(createdAt) + USER_IMPORT_TIMEOUT_MS + 60_000;
    assert.equal(
      resolveShareProgressState({
        source: { processingStatus: 'READY', candidateCount: 1 },
        timedOutAt: null,
        createdAt,
        nowMs,
      }),
      'ready',
    );
    assert.equal(
      resolveShareProgressState({
        source: { processingStatus: 'READY', candidateCount: 0 },
        timedOutAt: null,
        createdAt,
        nowMs,
      }),
      'nothing_yet',
    );
    assert.equal(
      resolveShareProgressState({
        source: { processingStatus: 'FAILED', candidateCount: 0 },
        timedOutAt: null,
        createdAt,
        nowMs,
      }),
      'couldnt_finish',
    );
  });
});
