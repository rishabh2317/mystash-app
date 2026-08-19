import type { TagStatus } from './types';

const TAG_TRANSITIONS: Record<TagStatus, readonly TagStatus[]> = {
  proposed: ['accepted', 'rejected', 'deleted'],
  accepted: ['published', 'rejected', 'archived', 'deleted', 'proposed'],
  rejected: ['proposed', 'deleted'],
  published: ['accepted', 'archived', 'deleted'],
  archived: ['accepted', 'deleted'],
  deleted: [],
};

export function canTransitionTagStatus(from: TagStatus, to: TagStatus): boolean {
  if (from === to) return true;
  return TAG_TRANSITIONS[from].includes(to);
}

export function assertTagStatusTransition(from: TagStatus, to: TagStatus): void {
  if (!canTransitionTagStatus(from, to)) {
    throw new Error(`Invalid tag_status transition: ${from} → ${to}`);
  }
}
