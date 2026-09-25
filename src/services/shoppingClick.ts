import { Platform } from 'react-native';
import { router, type Href } from 'expo-router';
import { merchantBrowserPath } from '@/src/ui/merchantBrowser';

export type ShoppingClickContext = {
  catalogProductId: string;
  /** Server-issued offer id. Never a merchant URL. */
  offerId?: string | null;
  /** Preferred Engagement attribution dim for MerchantClicked. */
  collectionId?: string | null;
  /** Legacy Home Reel video id — optional; do not pass collectionId as videoId. */
  videoId?: string | null;
  creatorId?: string | null;
  tagId?: string | null;
  country?: string | null;
  profileCountry?: string | null;
  locale?: string | null;
};

export type ShoppingDestination = {
  url: string;
  merchantName: string | null;
  country: string | null;
};

export { merchantBrowserPath };

function shoppingApiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new Error('Mystash shopping service is not configured.');
  }
  return base;
}

/**
 * Resolve the regional merchant destination from the backend.
 * Clients never invent merchant URLs.
 */
export async function resolveProductShoppingDestination(
  context: ShoppingClickContext,
): Promise<ShoppingDestination> {
  const query = new URLSearchParams();
  if (context.offerId?.trim()) query.set('offerId', context.offerId.trim());
  if (context.collectionId) query.set('collectionId', context.collectionId);
  if (context.videoId) query.set('videoId', context.videoId);
  if (context.creatorId) query.set('creatorId', context.creatorId);
  if (context.tagId) query.set('tagId', context.tagId);
  if (context.country) query.set('country', context.country);
  if (context.profileCountry) query.set('profileCountry', context.profileCountry);
  if (context.locale) query.set('locale', context.locale);
  query.set('platform', Platform.OS);
  query.set('format', 'json');

  const suffix = query.toString();
  const endpoint = `${shoppingApiBase()}/products/${encodeURIComponent(context.catalogProductId)}/redirect${
    suffix ? `?${suffix}` : ''
  }`;
  const res = await fetch(endpoint, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404 ? 'No shopping destination is available' : `Shopping redirect failed (${res.status})`,
    );
  }
  const body = (await res.json()) as { url?: unknown; merchantName?: unknown; country?: unknown };
  const url = typeof body.url === 'string' && body.url.startsWith('http') ? body.url : null;
  if (!url) throw new Error('Shopping destination was incomplete');
  return {
    url,
    merchantName: typeof body.merchantName === 'string' ? body.merchantName : null,
    country: typeof body.country === 'string' ? body.country : null,
  };
}

/**
 * Opens the merchant destination inside Mystash (in-app WebView).
 * Destination selection stays on the backend; clients only receive the resolved URL.
 */
export async function openProductShopping(context: ShoppingClickContext): Promise<void> {
  const destination = await resolveProductShoppingDestination(context);
  router.push(merchantBrowserPath(destination.url, destination.merchantName) as Href);
}
