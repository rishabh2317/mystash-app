/**
 * UX-CREATE-B.6 — Create-stack feedback helpers (inline / toast, not Alert).
 */

import { CREATE_COPY } from './createCopy';

/** Live URL field error when the pasted value is non-empty but unsupported. */
export function createUnsupportedUrlFieldError(url: string, isSupported: boolean): string | null {
  const trimmed = url.trim();
  if (!trimmed || isSupported) return null;
  return CREATE_COPY.unsupportedUrlBody;
}

/** Inline message when some manual product URLs failed extraction. */
export function createPartialProductLinksMessage(failedUrls: string[]): string | null {
  if (!failedUrls.length) return null;
  return `${CREATE_COPY.partialLinksBody} ${failedUrls.join(', ')}`;
}

/** True when the Create stack may use a system Alert (destructive confirms only). */
export function createAllowsSystemAlert(kind: 'discard' | 'other'): boolean {
  return kind === 'discard';
}
