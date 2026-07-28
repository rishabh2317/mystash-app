import type { IngestDraftPayload } from '@/src/types/curation';

const drafts = new Map<string, IngestDraftPayload>();

export function setCurationDraft(id: string, payload: IngestDraftPayload) {
  drafts.set(id, payload);
}

export function getCurationDraft(id: string): IngestDraftPayload | undefined {
  return drafts.get(id);
}

export function removeCurationDraft(id: string) {
  drafts.delete(id);
}
