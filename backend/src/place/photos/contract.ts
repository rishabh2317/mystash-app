/** Transient display resource. Never persist this response or put it in Stash rows. */
import { isPubliclyRoutableHost } from '../../user-import/domain/hostSafety';
export type PlaceImageResource = {
  source: 'google_places';
  uri: string;
  width: number;
  height: number;
  cachePolicy: 'none';
  attribution: {
    provider: 'Google Maps';
    sourceUrl: string;
    reportUrl: string | null;
    authors: { name: string; url: string | null; avatar: string | null }[];
    providers: { name: string; url: string | null }[];
  };
};
export type PlacePhotoFailure = 'timeout' | 'expired' | 'rate_limit' | 'transient' | 'invalid';
export type PlaceImageResponse = { image: PlaceImageResource | null; googlePlaceId?: string; failure?: PlacePhotoFailure; retryAfterMs?: number };

export function attributionLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  try { const url=new URL(raw);return url.protocol==='https:' && !url.username && !url.password && !url.port && isPubliclyRoutableHost(url.hostname) ? url.href : null; }
  catch { return null; }
}

/** No key-bearing URLs, arbitrary schemes, user-info or custom ports. */
export function googleContentUrl(raw: unknown, kind: 'image' | 'link'): string | null {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.searchParams.has('key')) return null;
    const host = url.hostname.toLowerCase();
    const matches = (root: string) => host === root || host.endsWith('.' + root);
    return (kind === 'image' ? matches('googleusercontent.com') || matches('ggpht.com') : matches('google.com') || host === 'maps.app.goo.gl') ? url.href : null;
  } catch { return null; }
}

/** Fail closed on API/version errors rather than crashing an otherwise usable card. */
export function readPlaceImageResource(value: unknown): PlaceImageResource | null {
  if (!value || typeof value!=='object') return null;
  const p=value as PlaceImageResource;
  const uri=googleContentUrl(p.uri,'image'),sourceUrl=googleContentUrl(p.attribution?.sourceUrl,'link');
  if(p.source!=='google_places'||p.cachePolicy!=='none'||!uri||!sourceUrl||!Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<=0||p.height<=0||!Array.isArray(p.attribution?.authors))return null;
  const people=(rows:unknown)=>Array.isArray(rows)?rows.flatMap(row=>row&&typeof row.name==='string'&&row.name.trim()
    ?[{name:row.name,url:attributionLink(row.url),avatar:googleContentUrl(row.avatar,'image')}]:[]):[];
  return {source:'google_places',cachePolicy:'none',width:p.width,height:p.height,uri,attribution:{provider:'Google Maps',sourceUrl,reportUrl:googleContentUrl(p.attribution.reportUrl,'link'),
    authors:people(p.attribution.authors),providers:people(p.attribution.providers).map(({name,url})=>({name,url}))}};
}
