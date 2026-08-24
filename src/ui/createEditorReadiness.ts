/**
 * UX-CREATE-B.5 — Collection Editor readiness + section summaries.
 * Pure helpers; no API/schema changes.
 */

import { isPublishableReviewProduct, reviewVerificationStatus } from '@/src/services/reviewResolution';
import type { DraftProduct } from '@/src/types/curation';

export type EditorReadinessItemId = 'content' | 'products' | 'resolving';

export type EditorReadinessItem = {
  id: EditorReadinessItemId;
  done: boolean;
  /** Count attached for resolving copy (optional). */
  count?: number;
};

export type EditorReadiness = {
  items: EditorReadinessItem[];
  ready: boolean;
  includedCount: number;
  attentionCount: number;
};

export function countIncludedProducts(
  products: DraftProduct[],
  selected: Record<string, boolean>,
): number {
  return products.filter((p) => p.id && selected[p.id]).length;
}

/** Included products that still block publish (resolving / unresolved / missing catalog). */
export function countAttentionIncludedProducts(
  products: DraftProduct[],
  selected: Record<string, boolean>,
): number {
  return products.filter((p) => {
    if (!p.id || !selected[p.id]) return false;
    return !isPublishableReviewProduct(p);
  }).length;
}

export function buildEditorReadiness(input: {
  hasContent: boolean;
  products: DraftProduct[];
  selected: Record<string, boolean>;
}): EditorReadiness {
  const includedCount = countIncludedProducts(input.products, input.selected);
  const attentionCount = countAttentionIncludedProducts(input.products, input.selected);
  const items: EditorReadinessItem[] = [
    { id: 'content', done: input.hasContent },
    { id: 'products', done: includedCount >= 1 },
    {
      id: 'resolving',
      done: includedCount >= 1 && attentionCount === 0,
      count: attentionCount,
    },
  ];
  return {
    items,
    ready: items.every((i) => i.done),
    includedCount,
    attentionCount,
  };
}

export function productsSectionMetaLabel(includedCount: number, attentionCount: number): string {
  if (includedCount < 1 && attentionCount < 1) return 'None included yet';
  const parts: string[] = [];
  parts.push(`${includedCount} included`);
  if (attentionCount > 0) parts.push(`${attentionCount} needs attention`);
  return parts.join(' · ');
}

export function contentPlatformLabel(platform: string | undefined): string {
  if (platform === 'youtube') return 'YouTube Short';
  if (platform === 'instagram') return 'Instagram Reel';
  return 'Video';
}

/** True when a selected product is still mid-resolution (for per-row hints). */
export function includedProductIsResolving(
  product: DraftProduct,
  selected: Record<string, boolean>,
): boolean {
  if (!product.id || !selected[product.id]) return false;
  return reviewVerificationStatus(product) === 'RESOLVING';
}
