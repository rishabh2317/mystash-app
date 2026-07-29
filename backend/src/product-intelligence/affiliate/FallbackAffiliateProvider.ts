import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AffiliateProvider,
  AffiliateResolveInput,
  AffiliateResolveResult,
} from '../interfaces/AffiliateProvider';

/**
 * Fallback affiliate wrapper (go.link). Merchant URL stays separate and immutable here.
 */
export class FallbackAffiliateProvider implements AffiliateProvider {
  readonly name = 'fallback';

  constructor(
    private readonly admin: SupabaseClient | null,
    private readonly ttlMs: number,
  ) {}

  async resolve(input: AffiliateResolveInput): Promise<AffiliateResolveResult> {
    const expiresAt = new Date(Date.now() + this.ttlMs);

    if (input.catalogProductId && this.admin) {
      const { data } = await this.admin
        .from('affiliate_links')
        .select('affiliate_url, expires_at')
        .eq('catalog_product_id', input.catalogProductId)
        .eq('provider', this.name)
        .maybeSingle();
      if (data?.affiliate_url && data.expires_at && new Date(data.expires_at as string) > new Date()) {
        return {
          affiliateUrl: String(data.affiliate_url),
          provider: this.name,
          expiresAt: new Date(data.expires_at as string),
        };
      }
    }

    const encoded = encodeURIComponent(input.merchantUrl);
    const affiliateUrl = `https://mystash.go.link/?d=${encoded}`;

    if (input.catalogProductId && this.admin) {
      await this.admin.from('affiliate_links').insert({
        catalog_product_id: input.catalogProductId,
        provider: this.name,
        merchant_url: input.merchantUrl,
        affiliate_url: affiliateUrl,
        expires_at: expiresAt.toISOString(),
        last_verified: new Date().toISOString(),
        status: 'ok',
        context: 'catalog',
        context_id: input.catalogProductId,
      });
    }

    return { affiliateUrl, provider: this.name, expiresAt };
  }
}
