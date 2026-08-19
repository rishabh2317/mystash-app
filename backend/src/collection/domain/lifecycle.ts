import type { CollectionStatus } from './types';

const ALLOWED: Record<CollectionStatus, CollectionStatus[]> = {
  draft: ['processing', 'rejected', 'deleted', 'ready_for_review', 'review_required'],
  processing: ['ready_for_review', 'review_required', 'draft', 'deleted'],
  ready_for_review: ['published', 'rejected', 'processing', 'deleted'],
  review_required: ['published', 'rejected', 'processing', 'deleted'],
  rejected: ['deleted'],
  published: ['published', 'unpublished', 'archived', 'deleted'],
  unpublished: ['published', 'archived', 'deleted'],
  archived: ['unpublished', 'deleted'],
  deleted: [],
};

export function canTransition(from: CollectionStatus, to: CollectionStatus): boolean {
  if (from === to && from === 'published') return true;
  return (ALLOWED[from] ?? []).includes(to);
}

export function assertTransition(from: CollectionStatus, to: CollectionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid collection transition: ${from} → ${to}`);
  }
}
