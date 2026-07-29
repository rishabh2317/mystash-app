import { Linking, Platform } from 'react-native';

export type ShoppingClickContext = {
  catalogProductId: string;
  videoId?: string | null;
  creatorId?: string | null;
  country?: string | null;
};

function shoppingApiBase(): string {
  const base = process.env.EXPO_PUBLIC_MYSTASH_INGEST_URL?.replace(/\/$/, '');
  if (!base) {
    throw new Error('Mystash shopping service is not configured.');
  }
  return base;
}

/** Opens only the backend redirect; destination selection never happens in the client. */
export async function openProductShopping(context: ShoppingClickContext): Promise<void> {
  const query = new URLSearchParams();
  if (context.videoId) query.set('videoId', context.videoId);
  if (context.creatorId) query.set('creatorId', context.creatorId);
  if (context.country) query.set('country', context.country);
  query.set('platform', Platform.OS);

  const suffix = query.toString();
  const url = `${shoppingApiBase()}/products/${encodeURIComponent(context.catalogProductId)}/redirect${
    suffix ? `?${suffix}` : ''
  }`;
  await Linking.openURL(url);
}
