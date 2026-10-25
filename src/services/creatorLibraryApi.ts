import { supabase } from '@/src/services/supabase';

export type CreatorLibraryItem = {
  membershipId: string;
  contentSourceId: string;
  platform: string;
  externalId: string;
  canonicalUrl: string;
  title: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  availability: 'available' | 'unavailable';
};

export type CreatorLibrarySnapshot = {
  items: CreatorLibraryItem[];
  sync: { status: 'idle' | 'running' | 'failed'; error: string | null; lastSyncAt: string | null } | null;
};

function apiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) throw new Error('Mystash service is not configured.');
  return base;
}

async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Library request failed (${res.status})`);
  return body;
}

export function listCreatorLibrary(): Promise<CreatorLibrarySnapshot> {
  return authed('/users/me/library');
}

export function requestCreatorLibrarySync(connectedAccountId: string): Promise<{ queued: boolean }> {
  return authed(`/users/me/connected-accounts/${connectedAccountId}/library/sync`, { method: 'POST' });
}

export type LibraryItemProduct = {
  id: string;
  name: string;
  catalogProductId: string | null;
  discoveredProductId: string | null;
  merchantUrl?: string | null;
  attachmentSource?: 'CREATOR_MANUAL' | 'CAMPAIGN' | 'BRAND_FEED' | null;
};

export type CampaignOffering = {
  campaignProductId: string;
  campaignName: string;
  brandName: string;
  catalogProductId: string;
  name: string;
  sku: string;
  provenance: 'CAMPAIGN' | 'BRAND_FEED';
};

export function listCampaignProducts(): Promise<{ products: CampaignOffering[] }> {
  return authed('/users/me/campaign-products');
}

export function attachCampaignProduct(
  contentSourceId: string,
  campaignProductId: string,
): Promise<{ catalogProductId: string; created: boolean }> {
  return authed(`/users/me/library/items/${contentSourceId}/campaign-products`, {
    method: 'POST',
    body: JSON.stringify({ campaignProductId }),
  });
}

export function listLibraryItemProducts(contentSourceId: string): Promise<{ products: LibraryItemProduct[] }> {
  return authed(`/users/me/library/items/${contentSourceId}/products`);
}

export function attachLibraryItemProduct(
  contentSourceId: string,
  input: { catalogProductId?: string; discoveredProductId?: string },
): Promise<{ created: boolean }> {
  return authed(`/users/me/library/items/${contentSourceId}/products`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeLibraryItemProduct(contentSourceId: string, productId: string): Promise<{ ok: boolean }> {
  return authed(`/users/me/library/items/${contentSourceId}/products/${productId}`, {
    method: 'DELETE',
  });
}

export type EditableCollection = { id: string; title: string | null; status: string };

export function listEditableCollections(): Promise<{ collections: EditableCollection[] }> {
  return authed('/users/me/collections');
}

export function addLibraryItemToCollection(
  contentSourceId: string,
  input: { collectionId?: string; title?: string },
): Promise<{ collectionId: string; createdCollection: boolean }> {
  return authed(`/users/me/library/items/${contentSourceId}/collections`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function publishCollection(collectionId: string): Promise<{ collection: { id: string; status: string } }> {
  return authed(`/collections/${collectionId}/publish`, {
    method: 'POST',
    body: JSON.stringify({ visibility: 'public' }),
  });
}
