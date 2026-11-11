import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ShareError, uuid } from './contracts';
import { emitCartEvent } from '../../cart/observability';
import { createDiscoveredProductService } from '../../discovered/factory';
import { ProductNormalizer } from '../../product-intelligence/normalizer/ProductNormalizer';
import { discoveredProductIdentityKey } from '../../product-intelligence/discovered/identity';
import { type MatchAssessment, type SimilarSuggestion } from './similarity';
import { assessFindMatches } from './findMatches';
import { assessMerchantIdentity } from '../../product-intelligence/verification/merchantEvidence';
import { rankForIntent } from './intentRanking';

export function createShareReviewService(db: SupabaseClient) {
  async function owned(user:string,id:string) {
    if (!uuid.test(id)) throw new ShareError('import_not_found',404);
    const r=await db.from('user_imports').select('id,content_source_id,interest_kind,interest_note').eq('id',id).eq('user_id',user).is('hidden_at',null).maybeSingle();
    if(r.error)throw new ShareError('share_review_unavailable',503);
    if(!r.data)throw new ShareError('import_not_found',404);return r.data;
  }
  async function detail(user: string, importId: string) {
    const imported=await owned(user,importId);
    const [p,r,places]=await Promise.all([
      db.from('content_source_products').select('id,name,match_assessment,catalog_product_id,discovered_product_id').eq('content_source_id',imported.content_source_id),
      db.from('user_import_product_reviews').select('source_product_id,candidate_key,state,product_id').eq('import_id',imported.id).eq('user_id',user),
      db.from('content_source_places').select('id,extracted_name,locality,city').eq('content_source_id',imported.content_source_id).order('id').limit(50),
    ]);
    if(p.error||r.error||places.error)throw new ShareError('share_review_unavailable',503);
    return {places:rankForIntent(places.data??[],{kind:imported.interest_kind,note:imported.interest_note},p=>[p.extracted_name,p.locality,p.city].filter(Boolean).join(' '))
      .map(p=>({id:p.id,name:p.extracted_name})),
      products:rankForIntent(p.data??[],{kind:imported.interest_kind,note:imported.interest_note},p=>p.name).map(p=>({sourceProductId:p.id,title:p.name,
      assessment:p.catalog_product_id||p.discovered_product_id?{version:1,policy:'share-similar-v1',kind:'exact',suggestions:[],reasonCodes:['existing_identity_validated']}:p.match_assessment as MatchAssessment|null,
      reviews:(r.data??[]).filter(r=>r.source_product_id===p.id)}))};
  }
  async function decide(user: string, importId: string, body: { sourceProductId?: unknown; candidateKey?: unknown; action?: unknown } | null) {
    const imported=await owned(user,importId);
    const {sourceProductId,candidateKey,action}=body??{};
    if(typeof sourceProductId!=='string'||!uuid.test(sourceProductId)||typeof candidateKey!=='string'||!/^[a-f0-9]{64}$/.test(candidateKey)||(typeof action!=='string'||!['save','dismiss'].includes(action)))throw new ShareError('invalid_review');
    const p=await db.from('content_source_products').select('*').eq('id',sourceProductId).eq('content_source_id',imported.content_source_id).maybeSingle();
    if(p.error)throw new ShareError('share_review_unavailable',503);
    const candidate=(p.data?.match_assessment as MatchAssessment|null)?.suggestions.find(s=>s.key===candidateKey);
    if(!p.data||!candidate||p.data.catalog_product_id||p.data.discovered_product_id)throw new ShareError('suggestion_unavailable',409);
    const lease=randomUUID();
    const claim=await db.rpc('share_review_claim',{p_user:user,p_import:imported.id,p_source:sourceProductId,p_key:candidateKey,p_lease:lease,p_dismiss:action==='dismiss'});
    if(claim.error)throw new ShareError('review_busy',409);
    if(action==='dismiss'||claim.data?.state==='accepted')return claim.data;
    // Revalidate persisted candidate evidence without fetching a merchant/provider.
    const current:SimilarSuggestion={...candidate};
    if(current.catalogId){
      const cat=await db.from('catalog_products').select('name,brand,model,category,image_url,merchant_url,verification_status').eq('id',current.catalogId).maybeSingle();
      if(cat.error||!cat.data||cat.data.verification_status!=='VERIFIED'||cat.data.merchant_url!==current.merchantUrl)throw new ShareError('suggestion_changed',409);
      Object.assign(current,{title:cat.data.name,brand:cat.data.brand,model:cat.data.model,category:cat.data.category});
    }
    const check=assessFindMatches(p.data,[{title:current.title,brand:current.brand,model:current.model,category:current.category,
      image:current.image,merchantUrl:current.merchantUrl,merchant:null,score:1,pdpVerdict:'pdp',pdpScore:1,
      sourceTier:'retailer',verifiedCatalogId:current.catalogId??undefined,enrichmentSucceeded:true,enrichmentMeta:{identitySource:'merchant_html'}}]);
    if(!check.suggestions.some(s=>s.key===candidateKey))throw new ShareError('suggestion_changed',409);
    let productId=current.catalogId;
    let discoveredProductId:string|null=null;
    if(!productId){
      const norm=new ProductNormalizer().normalize({draftId:sourceProductId,externalId:candidateKey,name:current.title,brand:current.brand,model:current.model,category:current.category,confidence:1});
      const saved=await createDiscoveredProductService(db).getOrCreate({name:current.title,brand:current.brand,model:current.model,category:current.category,
        imageUrl:current.image,merchantUrl:current.merchantUrl,merchant:null,price:null,currency:null,
        identityKey:discoveredProductIdentityKey(norm,current.merchantUrl),metadata:{source:'reviewed_merchant_candidate'},matchConfidence:null,completeness:null});
      if(saved.record.merchantUrl!==current.merchantUrl || !assessMerchantIdentity({name:current.title,brand:current.brand,model:current.model,category:current.category},
        {title:saved.record.name,brand:saved.record.brand,model:saved.record.model,category:saved.record.category,merchantUrl:saved.record.merchantUrl}).ok)throw new ShareError('suggestion_changed',409);
      discoveredProductId=saved.record.id;productId=discoveredProductId;
    }
    const done = await db.rpc('find_accept_suggestion', { p_user: user, p_import: imported.id, p_source: sourceProductId,
      p_key: candidateKey, p_lease: lease, p_catalog: current.catalogId ?? null, p_discovered: discoveredProductId });
    if (done.error || !done.data) throw new ShareError(done.error?.code === '23514' ? 'suggestion_changed' : 'review_confirmation_pending', done.error?.code === '23514' ? 409 : 503);
    if (done.data.cart) emitCartEvent('CartItemAdded', { userId: user, catalogProductId: done.data.cart.item.catalog_product_id ?? '',
      cartItemId: done.data.cart.item.id, created: done.data.cart.created, source: { surface: 'USER_IMPORT', userImportId: imported.id, contentSourceId: imported.content_source_id } });
    return { state: 'accepted', productId: done.data.productId };

  }
  return { detail, decide };
}
