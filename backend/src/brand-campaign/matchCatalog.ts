export type CatalogIdentity = {
  id: string;
  merchantUrl: string | null;
  brand: string | null;
  normalizedName: string;
};

export function normalizeBrandFeedName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function slugifyBrandFeed(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'item';
}

/**
 * Reuse an existing catalog row when merchant URL or brand + normalized name matches.
 * SKU is a feed key, not a second product identity.
 */
export function matchBrandFeedIdentity(
  item: { merchantUrl?: string | null; brand?: string | null; normalizedName: string },
  catalog: readonly CatalogIdentity[],
): string | null {
  const url = item.merchantUrl?.trim() || '';
  if (url) {
    const byUrl = catalog.find((row) => row.merchantUrl?.trim() === url);
    if (byUrl) return byUrl.id;
  }
  const brand = item.brand?.trim().toLowerCase() || '';
  const name = item.normalizedName.trim();
  if (brand && name) {
    const byName = catalog.find(
      (row) => (row.brand ?? '').trim().toLowerCase() === brand && row.normalizedName === name,
    );
    if (byName) return byName.id;
  }
  return null;
}
