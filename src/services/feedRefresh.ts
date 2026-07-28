/** Bump when the home feed should refetch (e.g. after publish). Subscribers run on the JS thread. */
const listeners = new Set<() => void>();

export function requestFeedReload(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeFeedReload(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
