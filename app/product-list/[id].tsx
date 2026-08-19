import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

/**
 * Deprecated legacy route. Compatibility redirect only —
 * do not restore product-list UI or Video-as-Collection-id behavior.
 */
export default function ProductListCompatibilityRedirect() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const collectionId = Array.isArray(id) ? id[0] : id;

  if (!collectionId?.trim()) {
    return <Redirect href="/" />;
  }

  return <Redirect href={`/collection/${collectionId.trim()}` as Href} />;
}
