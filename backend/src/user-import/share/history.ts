import { readFindMemberships } from '../find/membershipQuery';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ShareError, uuid } from './contracts';
import { findPresentation } from '../find/presentation';
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
  const [sources, products] = ids.length ? await Promise.all([
    db.from('content_sources').select('id,title,thumbnail_url').in('id',ids),
    db.from('content_source_products').select('id,content_source_id,name,image,catalog_product_id,discovered_product_id,match_assessment').in('content_source_id',ids),
  ]) : [];
  if ([sources, products].some(r => r?.error)) throw new ShareError('share_history_unavailable',503);
  const memberships = await readFindMemberships(db, userId, page.map(r => r.id));
  const shares = page.map(row => {
    const source = sources?.data?.find(s=>s.id===row.content_source_id);
    const results = (products?.data ?? []).filter(p=>p.content_source_id===row.content_source_id);
    const membership = memberships.get(row.id);
    if (!membership) throw new ShareError('share_history_unavailable', 503);
    const bound = rankForIntent([...results.filter(p=>p.catalog_product_id || p.discovered_product_id)
      .map(p=>({productId:p.catalog_product_id??p.discovered_product_id,title:p.name,imageUrl:p.image})), ...membership.selectedProducts],
      {kind:row.interest_kind??null,note:row.interest_note??null},p=>p.title);
    const findOutcome = membership.outcome;
    const unique = [...new Map(bound.map(p => [p.productId, p])).values()];
    return { ...findPresentation(findOutcome, unique), importId:row.id,createdAt:row.created_at,kind:row.platform,sourceUrl:row.source_url,
      contentSourceId:row.content_source_id,
      intent:{kind:row.interest_kind??null,note:row.interest_note??null,revision:row.intent_revision??0},
      sourceTitle:source?.title??null,thumbnailUrl:source?.thumbnail_url??null,
      matchSummary:results.map(p=>({sourceProductId:p.id,title:p.name,kind:p.catalog_product_id||p.discovered_product_id?'exact':p.match_assessment?.kind??'unable_to_identify'})) };
  });
  const last = page.at(-1);
  return { shares, nextCursor: rows.data!.length>limit && last ? Buffer.from(JSON.stringify({created_at:last.created_at,id:last.id})).toString('base64url'):null };
}
