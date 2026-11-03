import type { IngestDraftPayload } from '@/src/types/curation';

const drafts = new Map<string, IngestDraftPayload>();
const published = new Set<string>();

export function isCurationDraftPublished(id: string): boolean {
  return published.has(id);
}

/** Fence stale in-flight reads after confirmed publication. Stores IDs only. */
export function markCurationDraftPublished(id: string) {
  published.add(id);
  if (published.size > 200) published.delete(published.values().next().value!);
  drafts.delete(id);
}

export function setCurationDraft(id: string, payload: IngestDraftPayload) {
  if (published.has(id) || payload.status === 'published' || payload.status === 'rejected') return;
  drafts.set(id, payload);
}

export function getCurationDraft(id: string): IngestDraftPayload | undefined {
  return drafts.get(id);
}

export function removeCurationDraft(id: string) {
  drafts.delete(id);
}
