import type { CatalogStatus } from './types';

const ALLOWED: Record<CatalogStatus, ReadonlySet<CatalogStatus>> = {
  ACTIVE: new Set(['HIDDEN', 'DISCONTINUED', 'MERGED']),
  HIDDEN: new Set(['ACTIVE', 'DISCONTINUED', 'MERGED']),
  DISCONTINUED: new Set(['ACTIVE', 'HIDDEN', 'MERGED']),
  MERGED: new Set(), // terminal for source rows
};

export function assertCatalogStatusTransition(
  from: CatalogStatus,
  to: CatalogStatus,
): void {
  if (from === to) return;
  const next = ALLOWED[from];
  if (!next?.has(to)) {
    throw new Error(`Illegal Catalog status transition: ${from} → ${to}`);
  }
}

export function statusAfterLifecycleAction(
  current: CatalogStatus,
  action: 'hide' | 'unhide' | 'discontinue' | 'restore',
): CatalogStatus {
  if (current === 'MERGED') {
    throw new Error('Cannot change lifecycle of a MERGED Catalog product');
  }
  switch (action) {
    case 'hide':
      return 'HIDDEN';
    case 'unhide':
    case 'restore':
      return 'ACTIVE';
    case 'discontinue':
      return 'DISCONTINUED';
    default:
      throw new Error(`Unknown lifecycle action: ${action}`);
  }
}
