import {isPubliclyRoutableHost} from '../user-import/domain/hostSafety';
/** Only public HTTP media; private Storage, uploads and signed capabilities never leave this boundary. */
export function publicImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!isPubliclyRoutableHost(url.hostname)) return null;
    if (/find[_-]?(private|image)|ingest[_-]?frames|\/storage\/v1\/object\/(sign|authenticated)\//i.test(url.pathname)) return null;
    if ([...url.searchParams.keys()].some(key => /token|signature|credential|authorization|x-amz/i.test(key))) return null;
    if (url.hostname.endsWith('.supabase.co') && !url.pathname.startsWith('/storage/v1/object/public/profile-photos/')) return null;
    return url.href;
  } catch { return null; }
}
