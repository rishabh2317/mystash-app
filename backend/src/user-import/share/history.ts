import type { SupabaseClient } from '@supabase/supabase-js';
import { ShareError, uuid } from './contracts';
import { resolveShareProgressState } from '../domain/shareProgress';
import { rankForIntent } from './intentRanking';

export function parseHistoryCursor(cursor: unknown): { created_at: string; id: string } | null {
  if (cursor == null || cursor === '') return null;
  try {
    if (typeof cursor !== 'string' || cursor.length > 256) throw new Error();
    const value = JSON.parse(Buffer.from(cursor,'base64url').toString());
    if (!uuid.test(value.id) || typeof value.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.created_at) || !Number.isFinite(Date.parse(value.created_at))) throw new Error();
    // Preserve PostgreSQL microseconds; JS Date truncation can skip cursor ties.
    return { id: value.id, created_at: value.created_at };
  } catch { throw new ShareError('invalid_cursor'); }
}
export async function shareHistory(db: SupabaseClient, userId: string, cursor: unknown, rawLimit: unknown) {
  const limit = rawLimit == null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ShareError('invalid_limit');
  const after = parseHistoryCursor(cursor);
  let query = db.from('user_imports').select('*').eq('user_id',userId).is('hidden_at',null)
    .order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit+1);
  if (after) query = query.or(`created_at.lt.${after.created_at},and(created_at.eq.${after.created_at},id.lt.${after.id})`);
  const rows = await query;
  if (rows.error) throw new ShareError('share_history_unavailable',503);
  const page = (rows.data ?? []).slice(0,limit), ids = [...new Set(page.map(r => r.content_source_id).filter(Boolean))];
  const [sources, products, progress, places] = ids.length ? await Promise.all([
    db.from('content_sources').select('id,processing_status,candidate_count,queued_at,title,thumbnail_url').in('id',ids),
    db.from('content_source_products').select('id,content_source_id,name,image,catalog_product_id,discovered_product_id,match_assessment').in('content_source_id',ids),
    db.from('content_source_import_progress').select('*').in('content_source_id',ids),
    db.from('user_place_save_sources').select('user_import_id,content_source_place_id').eq('user_id',userId).in('user_import_id',page.map(r=>r.id)),
  ]) : [];
  if ([sources,products,progress,places].some(r => r?.error)) throw new ShareError('share_history_unavailable',503);
  const shares = page.map(row => {
    const source = sources?.data?.find(s=>s.id===row.content_source_id);
    const outcomes = progress?.data?.find(p=>p.content_source_id===row.content_source_id && (!source?.queued_at || Date.parse(p.started_at)>=Date.parse(source.queued_at)));
    const results = (products?.data ?? []).filter(p=>p.content_source_id===row.content_source_id);
    const bound = rankForIntent(results.filter(p=>p.catalog_product_id || p.discovered_product_id),
      {kind:row.interest_kind??null,note:row.interest_note??null},p=>p.name)
      .map(p=>({productId:p.catalog_product_id??p.discovered_product_id,title:p.name,imageUrl:p.image}));
    const placeCount = new Set((places?.data ?? []).filter(p=>p.user_import_id===row.id).map(p=>p.content_source_place_id)).size;
    const terminal = source?.processing_status === 'FAILED' ? 'failed' : source?.processing_status === 'READY' ? 'complete' : 'running';
    const state = resolveShareProgressState({source: source ? { processingStatus:source.processing_status,candidateCount:source.candidate_count,placeCardCount:placeCount } : null,
      timedOutAt:row.timed_out_at,createdAt:row.created_at,attemptStartedAt:row.attempt_started_at});
    return { importId:row.id,createdAt:row.created_at,kind:row.platform,sourceUrl:row.source_url,
      contentSourceId:row.content_source_id,state,productCount:bound.length,products:bound,primaryProduct:bound[0]??null,
      resultVersion:1,resultProductCount:bound.length,resultProducts:bound,placeCount,
      productStatus:outcomes?.product_status??terminal,placeStatus:outcomes?.place_status??terminal,
      hasInFlight:state==='looking',canRetry:state==='couldnt_finish',
      intent:{kind:row.interest_kind??null,note:row.interest_note??null,revision:row.intent_revision??0},
      sourceTitle:source?.title??null,thumbnailUrl:source?.thumbnail_url??null,
      matchSummary:results.map(p=>({sourceProductId:p.id,title:p.name,kind:p.catalog_product_id||p.discovered_product_id?'exact':p.match_assessment?.kind??'unable_to_identify'})) };
  });
  const last = page.at(-1);
  return { shares, nextCursor: rows.data!.length>limit && last ? Buffer.from(JSON.stringify({created_at:last.created_at,id:last.id})).toString('base64url'):null };
}
