import { withRequestTimeout } from './requestTimeout';
import type { PlaceImageResponse, PlaceImageResource } from '../../backend/src/place/photos/contract';
import { readPlaceImageResource } from '../../backend/src/place/photos/contract';
import { imageDataUri, PlaceImageError, type PhotoFailure, type PlaceImageSize } from './placeImageMemory';

type Session = { userId: string; accessToken: string };
type RequestEntry = { owner: string; settled: boolean; promise: Promise<PlaceImageResource | null>; references: number; controller: AbortController };
type CacheEntry = { image: PlaceImageResource; bytes: number };
export type PlaceImageMetrics = {
  hits: number; misses: number; avoidedApiRequests: number; coalesced: number; apiRequests: number;
  imageDownloads: number; imageLoads: number; loadTimeMs: number; displayLoads: number; displayTimeMs: number; retries: number; cancelled: number;
  evictions: number; estimatedBytes: number; entries: number; failures: Record<PhotoFailure, number>;
};
const failureCounts = (): Record<PhotoFailure, number> => ({ offline: 0, timeout: 0, expired: 0, rate_limit: 0, transient: 0, invalid: 0 });

/** Session-only LRU of image BYTES + credits. No native prefetch/loadAsync or disk persistence. */
export function createPlaceImageClient(deps: {
  baseURL(): string | undefined; session(): Promise<Session | null>; fetch: typeof fetch;
  now?: () => number; wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  isOnline?: () => boolean | undefined; maxBytes?: number; maxEntries?: number;
  allowSessionReuse?: (source: PlaceImageResource['source']) => boolean;
}) {
  const now = deps.now ?? Date.now, maxBytes = deps.maxBytes ?? 24 * 1024 * 1024, maxEntries = deps.maxEntries ?? 32;
  const pending = new Map<string, RequestEntry>(), cache = new Map<string, CacheEntry>();
  const aliases = new Map<string, string>(), cooldowns = new Map<string, number>();
  let owner: string | null = null, epoch = 0, running = 0;
  const waiting: { run(): void; cancel(): void }[] = [];
  const metrics: PlaceImageMetrics = { hits: 0, misses: 0, avoidedApiRequests: 0, coalesced: 0, apiRequests: 0,
    imageDownloads: 0, imageLoads: 0, loadTimeMs: 0, displayLoads: 0, displayTimeMs: 0, retries: 0, cancelled: 0, evictions: 0, estimatedBytes: 0, entries: 0, failures: failureCounts() };
  const wait = deps.wait ?? ((ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new PlaceImageError('invalid')); return; }
    const abort = () => { clearTimeout(timer); reject(new PlaceImageError('invalid')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  }));
  function remove(key: string) {
    const entry = cache.get(key); if (!entry) return;
    metrics.estimatedBytes -= entry.bytes; cache.delete(key); metrics.entries = cache.size;
    for (const [id, value] of aliases) if (value === key) aliases.delete(id);
  }
  function clear(keep?: AbortController, keepOwner?: string) {
    epoch++;
    for (const request of pending.values()) if (request.controller !== keep && request.owner !== keepOwner) request.controller.abort();
    for (const [key, request] of pending) if (request.controller !== keep && request.owner !== keepOwner) pending.delete(key);
    cache.clear(); aliases.clear(); cooldowns.clear(); metrics.estimatedBytes = 0; metrics.entries = 0;
  }
  function setOwner(next: string | null, keep?: AbortController) { if (owner !== next) { clear(keep, keep ? next ?? undefined : undefined); owner = next; } }
  async function bounded<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T | null> {
    if (signal.aborted) return null;
    if (running >= 3) {
      const admitted = await new Promise<boolean>(resolve => {
        const ticket = { run() { signal.removeEventListener('abort', ticket.cancel); resolve(true); },
          cancel() { const i = waiting.indexOf(ticket); if (i >= 0) waiting.splice(i, 1); resolve(false); } };
        waiting.push(ticket); signal.addEventListener('abort', ticket.cancel, { once: true });
      });
      if (!admitted) return null;
    } else running++;
    try { return signal.aborted ? null : await work(); }
    finally { const next = waiting.shift(); if (next) next.run(); else running--; }
  }
  async function fetchTimed<T>(url: string, init: RequestInit, ms: number, parent: AbortSignal, consume: (response: Response) => Promise<T>) {
    return withRequestTimeout(ms, async timeout => {
      const attempt = new AbortController();
      const abort = () => attempt.abort(); parent.addEventListener('abort', abort); timeout.addEventListener('abort', abort);
      if (parent.aborted) attempt.abort();
      try { return await consume(await deps.fetch(url, { ...init, signal: attempt.signal })); }
      catch (error) { if (timeout.aborted && !parent.aborted) throw new PlaceImageError('timeout'); throw error; }
      finally { parent.removeEventListener('abort', abort); timeout.removeEventListener('abort', abort); }
    });
  }
  function retryAfter(response: Response) {
    const value = response.headers.get('Retry-After');
    if (!value) return 0;
    const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now();
    return Number.isFinite(ms) ? Math.max(0, Math.min(ms, 60000)) : 0;
  }
  function classify(error: unknown): PlaceImageError {
    if (error instanceof PlaceImageError) return error;
    // Native fetch does not reliably distinguish offline from network unreachable. Never spin on it.
    if (error instanceof TypeError || deps.isOnline?.() === false) return new PlaceImageError('offline');
    return new PlaceImageError('transient');
  }
  return {
    setOwner,
    clear,
    recordDisplay(ms: number) { if (Number.isFinite(ms) && ms >= 0) { metrics.displayLoads++; metrics.displayTimeMs += ms; } },
    metrics: () => ({ ...metrics, failures: { ...metrics.failures }, activeRequests: running, queuedRequests: waiting.length }),
    invalidate(placeId: string, width: PlaceImageSize) { const key = aliases.get(`${placeId}:${width}`); if (key) remove(key); cooldowns.delete(`${placeId}:${width}`); },
    acquire(requestOwner: string, placeId: string, width: PlaceImageSize, importId?: string) {
      // Caller state is checked against the real session before ANY cache delivery.
      const requestKey = JSON.stringify([requestOwner, placeId, width]);
      let entry = pending.get(requestKey);
      if (entry) { metrics.coalesced++; metrics.avoidedApiRequests++; }
      if (!entry) {
        const controller = new AbortController();
        const request = (async () => {
          const session = await deps.session();
          if (controller.signal.aborted || session?.userId !== requestOwner) return null;
          setOwner(session.userId, controller);
          if (controller.signal.aborted) return null;
          const generation = epoch, id = `${placeId}:${width}`, alias = aliases.get(id), cached = alias ? cache.get(alias) : undefined;
          if (cached) {
            cache.delete(alias!); cache.set(alias!, cached); metrics.hits++; metrics.avoidedApiRequests++;
            return cached.image;
          }
          metrics.misses++;
          return bounded(async () => {
          if ((cooldowns.get(id) ?? 0) > now()) return null;
          if (deps.isOnline?.() === false) { metrics.failures.offline++; return null; }
          const base = deps.baseURL()?.replace(/\/$/, ''); if (!base) return null;
          const started = now(); let resource: PlaceImageResource | null = null;
          let googlePlaceId: string | undefined;
          for (let attempt = 0; attempt < 3; attempt++) {
            if (controller.signal.aborted || epoch !== generation) return null;
            try {
              if (!resource) {
                metrics.apiRequests++;
                const query = new URLSearchParams({ width: String(width), ...(importId ? { importId } : {}) });
                const { response, result } = await fetchTimed(`${base}/places/${encodeURIComponent(placeId)}/photo?${query}`, {
                  cache: 'no-store', headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json', 'Cache-Control': 'no-store' },
                }, 15000, controller.signal, async response => ({response,result:response.ok?await response.json() as PlaceImageResponse:null}));
                if (!response.ok) throw new PlaceImageError(response.status === 429 ? 'rate_limit' : response.status >= 500 ? 'transient' : 'invalid', retryAfter(response));
                if (!result) return null;
                if (result.failure) throw new PlaceImageError(['timeout','expired','rate_limit','transient','invalid'].includes(result.failure)?result.failure:'invalid', Number.isFinite(result.retryAfterMs)?result.retryAfterMs:0);
                resource = readPlaceImageResource(result.image);
                googlePlaceId = result.googlePlaceId;
                if (!resource) return null;
              }
              metrics.imageDownloads++;
              const {bytes,mime} = await fetchTimed(resource.uri, { cache: 'no-store', headers: { 'Cache-Control': 'no-store' } }, 10000, controller.signal, async response => {
                if (!response.ok) throw new PlaceImageError([400,403,404,410].includes(response.status) ? 'expired' : response.status === 429 ? 'rate_limit' : 'transient', retryAfter(response));
                const mime = response.headers.get('Content-Type')?.split(';')[0].toLowerCase();
                if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime) || Number(response.headers.get('Content-Length') ?? 0) > 4 * 1024 * 1024) throw new PlaceImageError('invalid');
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new PlaceImageError('invalid');
                return {bytes,mime};
              });
              const current = await deps.session();
              if (controller.signal.aborted || current?.userId !== requestOwner || epoch !== generation) return null;
              const image = { ...resource, uri: imageDataUri(bytes, mime) };
              // Conservative estimate: UTF-16 base64 + decoded RGBA at requested resolution.
              const size = image.uri.length * 2 + width * width * 4 + JSON.stringify(image.attribution).length * 2;
              if ((deps.allowSessionReuse?.(image.source) ?? true) && size <= maxBytes && maxEntries > 0 && googlePlaceId && /^[a-zA-Z0-9_-]{1,255}$/.test(googlePlaceId)) {
                const key = `${image.source}:${googlePlaceId}:${width}`;
                remove(key);
                while (cache.size >= maxEntries || metrics.estimatedBytes + size > maxBytes) { remove(cache.keys().next().value!); metrics.evictions++; }
                cache.set(key, { image, bytes: size }); aliases.set(id, key); metrics.estimatedBytes += size; metrics.entries = cache.size;
              }
              metrics.imageLoads++; metrics.loadTimeMs += now() - started;
              return image;
            } catch (error) {
              const failure = classify(error); metrics.failures[failure.kind]++;
              if (controller.signal.aborted || failure.kind === 'offline' || failure.kind === 'invalid') return null;
              if (failure.kind === 'expired') resource = null;
              const delay = Math.max(500 * 2 ** attempt, Math.min(failure.retryAfterMs, 60000));
              if (attempt === 2 || delay > 4000) { cooldowns.set(id, now() + Math.max(delay, 30000)); if (cooldowns.size > 128) cooldowns.delete(cooldowns.keys().next().value!); return null; }
              metrics.retries++; await wait(delay, controller.signal);
            }
          }
          return null;
          }, controller.signal);
        })().catch(() => null).finally(() => { if (pending.get(requestKey)?.controller === controller) { pending.get(requestKey)!.settled = true; pending.delete(requestKey); } });
        entry = { owner: requestOwner, settled: false, promise: request, references: 0, controller }; pending.set(requestKey, entry);
      }
      entry.references++;
      const selected = entry; let released = false;
      return { promise: selected.promise, release() {
        if (released) return; released = true; selected.references--;
        if (!selected.references && !selected.settled) { metrics.cancelled++; selected.controller.abort(); if (pending.get(requestKey) === selected) pending.delete(requestKey); }
      } };
    },
  };
}
