import assert from 'node:assert/strict';
import { it } from 'node:test';
import { getCurationDraft, isCurationDraftPublished, markCurationDraftPublished, setCurationDraft } from './curationDraftStore';
import type { IngestDraftPayload } from '@/src/types/curation';

const draft = (id: string): IngestDraftPayload => ({ ingestId: id, platform: 'youtube',
  sourceUrl: 'https://youtube.com/shorts/dQw4w9WgXcQ', status: 'ready_for_review', products: [] });

it('confirmed publication evicts the active draft and fences an older in-flight snapshot', () => {
  const row = draft('confirmed');
  setCurationDraft(row.ingestId, row);
  markCurationDraftPublished(row.ingestId);
  setCurationDraft(row.ingestId, row);
  assert.equal(getCurationDraft(row.ingestId), undefined);
  assert.equal(isCurationDraftPublished(row.ingestId), true);
});

it('failed drafts remain available and can be retried without replacing identity or products', () => {
  const row = { ...draft('failed-retry'), status: 'failed' as const };
  setCurationDraft(row.ingestId, row);
  assert.deepEqual(getCurationDraft(row.ingestId), row);
  assert.equal(isCurationDraftPublished(row.ingestId), false);
  setCurationDraft(row.ingestId, { ...row, status: 'ready_for_review' });
  assert.equal(getCurationDraft(row.ingestId)?.ingestId, 'failed-retry');
});

it('terminal published/rejected snapshots never become active local drafts', () => {
  for (const status of ['published', 'rejected'] as const) {
    setCurationDraft(status, { ...draft(status), status });
    assert.equal(getCurationDraft(status), undefined);
  }
});
