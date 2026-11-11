import { attributionLink, googleContentUrl, type PlaceImageResource, type PlacePhotoFailure } from './contract';

export class PlacePhotoError extends Error {
  constructor(readonly kind: PlacePhotoFailure, readonly retryAfterMs = 0) { super(`place_photo_${kind}`); }
}
export const PLACE_PHOTO_FIELDS = 'id,photos,attributions';
type Photo = { name: string; widthPx: number; heightPx: number; googleMapsUri: string;
  authorAttributions?: { displayName?: string; uri?: string; photoUri?: string }[]; flagContentUri?: string };
export type PlacePhotoProvider = { photo(placeId: string, width: number): Promise<PlaceImageResource | null> };

/** Dimensions describe suitability, not subject matter. Google's order breaks ties. */
export function selectPlacePhoto(value: unknown, placeId: string, width: number): Photo | null {
  if (!Array.isArray(value)) return null;
  const candidates = value.slice(0, 10).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const p = item as Photo;
    if (typeof p.name !== 'string' || !p.name.startsWith(`places/${placeId}/photos/`)
      || !/^[a-zA-Z0-9_-]+$/.test(p.name.slice(`places/${placeId}/photos/`.length))
      || !Number.isFinite(p.widthPx) || !Number.isFinite(p.heightPx) || Math.min(p.widthPx,p.heightPx) < 128
      || !googleContentUrl(p.googleMapsUri,'link')) return [];
    const ratio = p.widthPx / p.heightPx;
    if (ratio > 4 || ratio < 0.25) return [];
    const cropCoverage = Math.min(ratio, 1 / ratio);
    const resolution = Math.min(1, Math.min(p.widthPx,p.heightPx) / width);
    return [{ p, score: 0.7 * cropCoverage + 0.25 * resolution + 0.05 * (1-index/10) }];
  });
  return candidates.sort((a,b) => b.score-a.score)[0]?.p ?? null;
}

/** Only in-flight coalescing. No resolved metadata, reference, URI or bytes cache. */
export class GooglePlacePhotoProvider implements PlacePhotoProvider {
  private readonly counts = { metadataRequests: 0, successfulPhotoRequests: 0, photoRequests: 0, failures: 0, coalesced: 0 };
  metrics() { return { ...this.counts, activeRequests: this.pending.size }; }
  private readonly pending = new Map<string, Promise<PlaceImageResource | null>>();
  constructor(private readonly options: { apiKey?: string | null; fetchImpl?: typeof fetch; maxConcurrent?: number } = {}) {}

  photo(placeId: string, width: number): Promise<PlaceImageResource | null> {
    if (!this.options.apiKey || !/^[a-zA-Z0-9_-]{1,255}$/.test(placeId)) return Promise.resolve(null);
    const key = `${placeId}:${width}`;
    const existing = this.pending.get(key);
    if (existing) { this.counts.coalesced++; return existing; }
    if (this.pending.size >= (this.options.maxConcurrent ?? 8)) return Promise.reject(new PlacePhotoError('rate_limit', 1000));
    const request = this.load(placeId,width).catch(error => { this.counts.failures++; throw error instanceof PlacePhotoError ? error : new PlacePhotoError(error?.name === 'TimeoutError' ? 'timeout' : 'transient'); }).finally(() => { this.pending.delete(key); });
    this.pending.set(key,request);
    return request;
  }

  private failure(response: Response, media = false) {
    const kind = response.status === 429 ? 'rate_limit' : media && [400, 404, 410].includes(response.status) ? 'expired' : response.status >= 500 ? 'transient' : 'invalid';
    const retry = response.headers.get('Retry-After');
    const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
    return new PlacePhotoError(kind, Number.isFinite(delay) ? Math.min(delay, 60000) : 0);
  }
  private async load(placeId: string, width: number): Promise<PlaceImageResource | null> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const headers = { 'X-Goog-Api-Key': this.options.apiKey!, 'Cache-Control':'no-store' };
    this.counts.metadataRequests++;
    const details = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { ...headers, 'X-Goog-FieldMask': PLACE_PHOTO_FIELDS }, cache:'no-store', redirect:'error', signal:AbortSignal.timeout(6000),
    });
    if (!details.ok) throw this.failure(details);
    const body = await details.json() as { id?: string; photos?: unknown; attributions?: { provider?: string; providerUri?: string }[] };
    if (body.id !== placeId) return null;
    const photo = selectPlacePhoto(body.photos,placeId,width);
    if (!photo) return null;
    this.counts.photoRequests++;
    const media = await fetchImpl(`https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=${width}&maxHeightPx=${width}&skipHttpRedirect=true`, {
      headers, cache:'no-store', redirect:'error', signal:AbortSignal.timeout(6000),
    });
    if (!media.ok) throw this.failure(media, true);
    this.counts.successfulPhotoRequests++;
    const data = await media.json() as { photoUri?: unknown };
    const uri = googleContentUrl(data.photoUri,'image');
    if (!uri) return null;
    return { source:'google_places',uri,width:photo.widthPx,height:photo.heightPx,cachePolicy:'none',
      attribution:{ provider:'Google Maps',sourceUrl:googleContentUrl(photo.googleMapsUri,'link')!, reportUrl:googleContentUrl(photo.flagContentUri,'link'),
        authors: Array.isArray(photo.authorAttributions) ? photo.authorAttributions.flatMap(author => typeof author?.displayName === 'string' && author.displayName.trim()
          ? [{name:author.displayName,url:attributionLink(author.uri),avatar:googleContentUrl(author.photoUri,'image')}] : []) : [],
        providers: Array.isArray(body.attributions) ? body.attributions.flatMap(p => typeof p?.provider === 'string' && p.provider.trim()
          ? [{ name:p.provider,url:attributionLink(p.providerUri) }] : []) : [] } };
  }
}
