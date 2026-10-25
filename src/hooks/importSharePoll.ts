/** One list refresh while any share is still looking. */
export const IMPORT_SHARE_POLL_MS = 1500;

/**
 * One timer for the import-share list. A newer fetch or a blur wins, so a
 * stale response cannot stop polling or leave a second timer running.
 */
export type ImportSharePollDecision = 'poll' | 'stop' | 'ignore';

export function createImportSharePoller(deps: {
  intervalMs: number;
  schedule: (callback: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
}) {
  let intervalMs = deps.intervalMs;
  let focused = false;
  let generation = 0;
  let handle: unknown = null;
  let onTick: (() => void) | null = null;

  const clear = () => {
    if (handle == null) return;
    deps.cancel(handle);
    handle = null;
  };

  const arm = () => {
    if (!focused || handle != null || !onTick) return;
    const tick = onTick;
    handle = deps.schedule(() => {
      handle = null;
      tick();
    }, intervalMs);
  };

  return {
    setIntervalMs(ms: number) {
      intervalMs = ms;
    },
    setOnTick(fn: () => void) {
      onTick = fn;
    },
    focus() {
      focused = true;
    },
    blur() {
      focused = false;
      generation += 1;
      clear();
    },
    beginFetch(): number {
      return ++generation;
    },
    finishFetch(gen: number, inFlight: boolean): ImportSharePollDecision {
      if (!focused || gen !== generation) return 'ignore';
      if (!inFlight) {
        clear();
        return 'stop';
      }
      arm();
      return 'poll';
    },
    hasTimer(): boolean {
      return handle != null;
    },
  };
}
