import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCatalogRepository } from '../product-intelligence/catalog/SupabaseCatalogRepository';
import type { BrandFeedCatalog, BrandFeedCatalogRow } from './BrandCampaignService';

type Row = Record<string, unknown>;

export function supabaseBrandFeedCatalog(admin: SupabaseClient): BrandFeedCatalog {
  const catalog = new SupabaseCatalogRepository(admin);
  return {
    async listIdentity(): Promise<BrandFeedCatalogRow[]> {
      const { data, error } = await admin
        .from('catalog_products')
        .select('id, name, brand, normalized_name, merchant_url')
        .eq('status', 'ACTIVE');
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        brand: (row.brand as string) ?? null,
        normalizedName: String(row.normalized_name),
        merchantUrl: (row.merchant_url as string) ?? null,
      }));
    },
    async create(input): Promise<BrandFeedCatalogRow> {
      const created = await catalog.create({
        name: input.name,
        normalizedName: input.normalizedName,
        canonicalSlug: input.canonicalSlug,
        brand: input.brand,
        model: null,
        category: null,
        imageUrl: input.imageUrl,
        merchantUrl: input.merchantUrl,
        preferredShoppingUrl: input.buyUrl,
        currency: input.currency,
        price: input.price,
        verificationStatus: 'UNVERIFIED',
        verificationSource: 'brand_feed',
        verificationVersion: 'phase7',
        metadata: { provenance: 'BRAND_FEED' },
      });
      return {
        id: created.id,
        name: created.name,
        brand: created.brand,
        normalizedName: created.normalizedName,
        merchantUrl: created.merchantUrl,
      };
    },
  };
}
