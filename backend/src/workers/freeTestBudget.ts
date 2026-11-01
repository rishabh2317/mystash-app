/** Explicit Render testing opt-in. Existing local/production workers are unchanged. */
export function renderFreeTestEnabled(): boolean {
  return process.env.MYSTASH_RENDER_FREE_TEST === 'true';
}

let tail: Promise<void> = Promise.resolve();

type FreeTestWorker = { name: string; waitUntilReady(): Promise<unknown>; close(): Promise<void> };
const workers = new Set<FreeTestWorker>();
export function trackFreeTestWorker(worker: FreeTestWorker): void {
  if (renderFreeTestEnabled()) workers.add(worker);
}
export function registeredFreeTestWorkers(): FreeTestWorker[] { return [...workers]; }

/** Serialize heavy creator/user-import extraction across their separate queues. */
export async function withFreeTestExtractionSlot<T>(work: () => Promise<T>): Promise<T> {
  if (!renderFreeTestEnabled()) return work();
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await work(); } finally { release(); }
}

/** Decoder/encoder threading only; preserves timestamps, dimensions and JPEG quality. */
export function freeTestFrameThreads(): string[] {
  return renderFreeTestEnabled() ? ['-threads', '1'] : [];
}
