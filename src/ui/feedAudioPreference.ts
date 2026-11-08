import { useSyncExternalStore } from 'react';

// Session preference shared by Watch reels, including remounts after navigation.
let muted = true;
const listeners = new Set<() => void>();

export function feedMutedSnapshot(): boolean {
  return muted;
}

export function setFeedMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  listeners.forEach((listener) => listener());
}

export function subscribeFeedMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFeedMuted(): boolean {
  return useSyncExternalStore(subscribeFeedMuted, feedMutedSnapshot, feedMutedSnapshot);
}
