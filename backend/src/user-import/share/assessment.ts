import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentSourceProductRecord } from '../../content-source/domain/types';
import type { ResolveDraftResult, SearchCandidate } from '../../product-intelligence/domain/types';
import { assertImportWorkActive } from '../workContext';
import { type ReviewCandidate } from './similarity';
import { assessFindMatches, findGarmentType } from './findMatches';

export function createReviewAssessment(db: SupabaseClient, observed: Map<string, SearchCandidate[]>) {
  return async (product: ContentSourceProductRecord, _result?: ResolveDraftResult) => {
    assertImportWorkActive();
    const pool: ReviewCandidate[] = [...(observed.get(product.id) ?? [])];
    observed.delete(product.id);
    const exact = Boolean(product.catalogProductId || product.discoveredProductId);
    if (!exact && product.category) {
      // Bounded local reads only. Never invokes search/enrichment/AI.
      let lookup = db.from('catalog_products').select('id,name,brand,model,category,image_url,merchant_url,metadata')
        .eq('verification_status','VERIFIED').eq('category',product.category);
      const type = findGarmentType(product.name);
      if ((product.evidence?.identification as { kind?: string } | undefined)?.kind === 'possible' && type) {
        // Filter before the existing bound; unrelated first-page catalogue rows
        // must not consume all twenty possible-style slots.
        lookup = lookup.ilike('name', `%${type}%`);
      }
      const { data, error } = await lookup.order('id').limit(20);
      if (error) throw new Error('share_catalog_read_unavailable');
      for (const row of data ?? []) pool.push({ verifiedCatalogId: row.id, title: row.name, brand: row.brand,
        model: row.model, category: row.category, image: row.image_url, merchantUrl: row.merchant_url ?? '',
        merchant: null, score: 1, pdpVerdict: 'pdp', pdpScore: 1, sourceTier: 'retailer' });
    }
    const assessment = assessFindMatches(product, pool, exact);
    assertImportWorkActive();
    const { error } = await db.from('content_source_products').update({ match_assessment: assessment }).eq('id', product.id).eq('content_source_id',product.contentSourceId);
    if (error) throw new Error('share_assessment_write_unavailable');
  };
}
