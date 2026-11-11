import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { hydrateImportShares, type ImportShare } from './importShareMap';
export type ShareIntentValue = { kind: 'product' | 'place' | 'both' | null; note: string | null; revision: number };
export type SimilarSuggestionView = { key: string; title: string; image: string | null; score: number; kind?: 'possible' | 'similar_styles' };
export type ReviewProduct = { sourceProductId: string; title: string;
  assessment: { kind: 'exact' | 'possible' | 'similar' | 'unable_to_identify'; suggestions: SimilarSuggestionView[] } | null;
  reviews: { candidate_key: string; state: string; product_id: string | null }[] };
export async function shareRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  const { data } = await supabase.auth.getSession();
  if (!base || !data.session) throw new Error('Sign in to continue.');
  const response = await withRequestTimeout(15_000, signal => fetch(`${base}/imports${path}`, { method, signal,
    headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }));
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== data.session.user.id) throw new Error('Your account changed. Please reopen this share.');
  if (!response.ok) throw new Error(response.status === 409 ? 'This share changed. Refresh before trying again.' : 'Could not confirm this change. Please try again.');
  return response.json();
}
export async function fetchShareHistory(cursor?: string): Promise<{ shares: ImportShare[]; nextCursor: string | null }> {
  const result = await shareRequest<{ shares: unknown; nextCursor: string | null }>(`/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  return { shares: hydrateImportShares(result.shares), nextCursor: result.nextCursor };
}
export const fetchShareIntent = (id: string) => shareRequest<ShareIntentValue>(`/${encodeURIComponent(id)}/intent`);
export const updateShareIntent = (id: string, intent: ShareIntentValue) => shareRequest(`/${encodeURIComponent(id)}/intent`, 'PATCH',
  { intent: { kind: intent.kind, note: intent.note }, expectedRevision: intent.revision });
export const fetchShareReview = (id: string) => shareRequest<{ products: ReviewProduct[]; places: {id:string;name:string}[] }>(`/${encodeURIComponent(id)}/review`);
export const decideShareSuggestion = (id: string, sourceProductId: string, candidateKey: string, action: 'save' | 'dismiss') =>
  shareRequest(`/${encodeURIComponent(id)}/review`, 'POST', { sourceProductId, candidateKey, action });
