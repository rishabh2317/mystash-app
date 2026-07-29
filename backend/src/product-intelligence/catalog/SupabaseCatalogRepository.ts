import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CatalogProduct,
  CreateCatalogInput,
  SearchCandidate,
  UpdateCatalogInput,
} from '../domain/types';
import type {
  CatalogRepository,
  MatchHistoryWriter,
  SearchCandidateCache,
} from '../interfaces/CatalogRepository';

type Row = Record<string, unknown>;

function mapProduct(row: Row): CatalogProduct {
  return {
    id: String(row.id),
    canonicalSlug: String(row.canonical_slug),
    brand: (row.brand as string) ?? null,
    name: String(row.name),
    normalizedName: String(row.normalized_name),
    model: (row.model as string) ?? null,
    category: (row.category as string) ?? null,
    description: (row.description as string) ?? null,
    imageUrl: (row.image_url as string) ?? null,
    merchant: (row.merchant as string) ?? null,
    merchantUrl: (row.merchant_url as string) ?? null,
    affiliateUrl: (row.affiliate_url as string) ?? null,
    currency: (row.currency as string) ?? null,
    price: (row.price as string) ?? null,
    status: (row.status as CatalogProduct['status']) ?? 'ACTIVE',
    verificationStatus: (row.verification_status as CatalogProduct['verificationStatus']) ?? 'UNVERIFIED',
    verificationSource: (row.verification_source as string) ?? null,
    verificationVersion: (row.verification_version as string) ?? null,
    lastVerifiedAt: (row.last_verified_at as string) ?? null,
    aiConfidence: row.ai_confidence == null ? null : Number(row.ai_confidence),
    matchConfidence: row.match_confidence == null ? null : Number(row.match_confidence),
    verificationConfidence: row.verification_confidence == null ? null : Number(row.verification_confidence),
    mergedIntoId: (row.merged_into_id as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

function verificationRank(p: CatalogProduct): number {
  if (p.verificationStatus === 'VERIFIED') return 2;
  if (p.verificationStatus === 'UNVERIFIED') return 1;
  return 0;
}

export function sortPreferVerified(products: CatalogProduct[]): CatalogProduct[] {
  return [...products].sort((a, b) => verificationRank(b) - verificationRank(a));
}

export class SupabaseCatalogRepository implements CatalogRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async findByNormalizedName(normalizedName: string): Promise<CatalogProduct[]> {
    const { data } = await this.admin
      .from('catalog_products')
      .select('*')
      .eq('normalized_name', normalizedName)
      .eq('status', 'ACTIVE');
    return sortPreferVerified((data ?? []).map((r) => mapProduct(r as Row)));
  }

  async findByAlias(alias: string): Promise<CatalogProduct[]> {
    const { data: aliasRows } = await this.admin
      .from('catalog_aliases')
      .select('catalog_product_id')
      .eq('alias', alias.toLowerCase());
    const ids = [...new Set((aliasRows ?? []).map((r) => String((r as Row).catalog_product_id)))];
    if (!ids.length) return [];
    const { data } = await this.admin
      .from('catalog_products')
      .select('*')
      .in('id', ids)
      .eq('status', 'ACTIVE');
    return sortPreferVerified((data ?? []).map((r) => mapProduct(r as Row)));
  }

  async findByBrandModel(brand: string, model: string): Promise<CatalogProduct[]> {
    const { data } = await this.admin
      .from('catalog_products')
      .select('*')
      .ilike('brand', brand)
      .ilike('model', model)
      .eq('status', 'ACTIVE');
    return sortPreferVerified((data ?? []).map((r) => mapProduct(r as Row)));
  }

  async findByMerchantUrl(merchantUrl: string): Promise<CatalogProduct | null> {
    const { data } = await this.admin
      .from('catalog_products')
      .select('*')
      .eq('merchant_url', merchantUrl)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    if (!data) return null;
    return mapProduct(data as Row);
  }

  async findBySlug(slug: string): Promise<CatalogProduct | null> {
    const { data } = await this.admin
      .from('catalog_products')
      .select('*')
      .eq('canonical_slug', slug)
      .maybeSingle();
    return data ? mapProduct(data as Row) : null;
  }

  async findById(id: string): Promise<CatalogProduct | null> {
    const { data } = await this.admin.from('catalog_products').select('*').eq('id', id).maybeSingle();
    return data ? mapProduct(data as Row) : null;
  }

  async create(input: CreateCatalogInput): Promise<CatalogProduct> {
    let slug = input.canonicalSlug;
    for (let i = 0; i < 5; i++) {
      const existing = await this.findBySlug(slug);
      if (!existing) break;
      slug = `${input.canonicalSlug}-${i + 2}`;
    }

    const { data, error } = await this.admin
      .from('catalog_products')
      .insert({
        canonical_slug: slug,
        brand: input.brand,
        name: input.name,
        normalized_name: input.normalizedName,
        model: input.model,
        category: input.category,
        description: input.description ?? null,
        image_url: input.imageUrl ?? null,
        merchant: input.merchant ?? null,
        merchant_url: input.merchantUrl ?? null,
        affiliate_url: input.affiliateUrl ?? null,
        currency: input.currency ?? null,
        price: input.price ?? null,
        status: 'ACTIVE',
        verification_status: input.verificationStatus,
        verification_source: input.verificationSource,
        verification_version: input.verificationVersion,
        last_verified_at:
          input.verificationStatus === 'VERIFIED' ? new Date().toISOString() : null,
        ai_confidence: input.aiConfidence ?? null,
        match_confidence: input.matchConfidence ?? null,
        verification_confidence: input.verificationConfidence ?? null,
        metadata: input.metadata ?? {},
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error || !data) throw new Error(error?.message ?? 'catalog create failed');
    const product = mapProduct(data as Row);
    for (const a of input.aliases ?? []) {
      await this.addAlias(product.id, a);
    }
    return product;
  }

  async update(id: string, patch: UpdateCatalogInput): Promise<CatalogProduct> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`catalog update: ${id} not found`);

    const row: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.brand !== undefined) row.brand = patch.brand;
    if (patch.model !== undefined) row.model = patch.model;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl;
    if (patch.merchant !== undefined) row.merchant = patch.merchant;
    if (patch.merchantUrl !== undefined) row.merchant_url = patch.merchantUrl;
    if (patch.affiliateUrl !== undefined) row.affiliate_url = patch.affiliateUrl;
    if (patch.currency !== undefined) row.currency = patch.currency;
    if (patch.price !== undefined) row.price = patch.price;
    if (patch.availability !== undefined) row.availability = patch.availability;
    if (patch.verificationStatus !== undefined) {
      row.verification_status = patch.verificationStatus;
      if (patch.verificationStatus === 'VERIFIED' && patch.lastVerifiedAt === undefined) {
        row.last_verified_at = new Date().toISOString();
      }
    }
    if (patch.verificationSource !== undefined) row.verification_source = patch.verificationSource;
    if (patch.verificationVersion !== undefined) row.verification_version = patch.verificationVersion;
    if (patch.aiConfidence !== undefined) row.ai_confidence = patch.aiConfidence;
    if (patch.matchConfidence !== undefined) row.match_confidence = patch.matchConfidence;
    if (patch.verificationConfidence !== undefined) {
      row.verification_confidence = patch.verificationConfidence;
    }
    if (patch.lastVerifiedAt !== undefined) row.last_verified_at = patch.lastVerifiedAt;
    if (patch.metadata !== undefined) {
      row.metadata = { ...existing.metadata, ...patch.metadata };
    }

    const { data, error } = await this.admin
      .from('catalog_products')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'catalog update failed');
    return mapProduct(data as Row);
  }

  async addAlias(catalogProductId: string, alias: string): Promise<void> {
    const a = alias.toLowerCase().trim();
    if (!a) return;
    await this.admin.from('catalog_aliases').upsert(
      { catalog_product_id: catalogProductId, alias: a },
      { onConflict: 'catalog_product_id,alias', ignoreDuplicates: true },
    );
  }

  async listActiveForFuzzy(limit = 200): Promise<CatalogProduct[]> {
    const { data } = await this.admin
      .from('catalog_products')
      .select('*')
      .eq('status', 'ACTIVE')
      .order('updated_at', { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => mapProduct(r as Row));
  }
}

export class SupabaseSearchCandidateCache implements SearchCandidateCache {
  constructor(private readonly admin: SupabaseClient) {}

  async get(query: string, provider: string): Promise<SearchCandidate[] | null> {
    const now = new Date().toISOString();
    const { data } = await this.admin
      .from('catalog_search_candidates')
      .select('merchant, merchant_url, title, image, score')
      .eq('query', query)
      .eq('provider', provider)
      .gt('expires_at', now);
    if (!data?.length) return null;
    return data.map((r) => ({
      merchant: (r.merchant as string) ?? null,
      merchantUrl: String(r.merchant_url),
      title: String(r.title ?? ''),
      image: (r.image as string) ?? null,
      score: Number(r.score) || 0,
    }));
  }

  async set(
    query: string,
    provider: string,
    candidates: SearchCandidate[],
    ttlMs: number,
  ): Promise<void> {
    const expires = new Date(Date.now() + ttlMs).toISOString();
    // Replace prior cache rows for this query+provider
    await this.admin.from('catalog_search_candidates').delete().eq('query', query).eq('provider', provider);
    if (!candidates.length) return;
    await this.admin.from('catalog_search_candidates').insert(
      candidates.map((c) => ({
        query,
        provider,
        merchant: c.merchant,
        merchant_url: c.merchantUrl,
        title: c.title,
        image: c.image,
        score: c.score,
        expires_at: expires,
      })),
    );
  }
}

export class SupabaseMatchHistoryWriter implements MatchHistoryWriter {
  constructor(private readonly admin: SupabaseClient) {}

  async write(row: {
    draftId: string;
    catalogProductId: string | null;
    score: number | null;
    decision: string;
    reason: string;
    aiConfidence?: number | null;
    matchConfidence?: number | null;
    verificationConfidence?: number | null;
  }): Promise<void> {
    await this.admin.from('product_match_history').insert({
      draft_id: row.draftId,
      catalog_product_id: row.catalogProductId,
      score: row.score,
      decision: row.decision,
      reason: row.reason,
      ai_confidence: row.aiConfidence ?? null,
      match_confidence: row.matchConfidence ?? null,
      verification_confidence: row.verificationConfidence ?? null,
    });
  }
}
