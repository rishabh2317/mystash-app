import {isGeographyOnly} from '../../place/placeClassification';
import {samePlaceMention,type PlaceMentionIdentity} from '../../place/placeMentionDedupe';
import type {FindPlace} from './contract';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ShareError, uuid } from '../share/contracts';
import { parseHistoryCursor } from '../share/history';
import { readFindOutcome, readFindCounts } from './contract';

import type { FindItem, FindDetail, FindPage, FindCounts, FindBatch, FindSourceSummaryPage, FindSourceResultPage } from './contract';
export type { FindItem, FindDetail, FindPage, FindCounts, FindBatch } from './contract';

export function findId(id: unknown): string {
  if (typeof id !== 'string' || !uuid.test(id)) throw new ShareError('find_not_found', 404);
  return id;
}
export function findBatchIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some(id => typeof id !== 'string' || !uuid.test(id))) throw new ShareError('invalid_find_ids');
  return [...new Set(value as string[])];
}
function item(value: unknown): FindItem {
  if (!value || typeof value !== 'object' || !uuid.test(String((value as FindItem).id))) throw new ShareError('find_unavailable', 503);
  const row = value as FindItem;
  return { ...row, outcome: readFindOutcome(row.outcome) };
}

export class FindQueryService {
  constructor(private readonly db: SupabaseClient) {}
  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args).abortSignal(AbortSignal.timeout(25_000));
    if (error) {
      if (error.code === 'P0002') throw new ShareError('find_not_found', 404);
      if (error.code === '23514') throw new ShareError('find_result_unavailable', 409);
      throw new ShareError('find_unavailable', 503);
    }
    if (data == null) throw new ShareError('find_unavailable', 503);
    return data as T;
  }
  async list(userId: string, query: { cursor?: unknown; limit?: unknown; filter?: unknown; source?: unknown; savedKind?: unknown } = {}): Promise<FindPage> {
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (query.limit !== undefined && typeof query.limit !== 'string' && typeof query.limit !== 'number')) throw new ShareError('invalid_limit');
    const filter = query.filter ?? 'all';
    if (!['all','processing','completed','attention','saved'].includes(String(filter)) || typeof filter !== 'string') throw new ShareError('invalid_filter');
    const source = query.source;
    if (source !== undefined && (typeof source !== 'string' || !['all','image','instagram','youtube','web'].includes(source))) throw new ShareError('invalid_source');
    const savedKind = query.savedKind ?? 'all';
    if (typeof savedKind !== 'string' || !['all','product','place'].includes(savedKind)) throw new ShareError('invalid_saved_kind');
    const after = parseHistoryCursor(query.cursor);
    const scoped = (source && source !== 'all') || savedKind !== 'all';
    const result = await this.rpc<{ items: unknown[]; cursor: unknown; counts: FindCounts }>(savedKind !== 'all' ? 'find_query_by_source_kind' : scoped ? 'find_query_by_source' : 'find_query', {
      p_user: userId, ...(scoped ? { p_source: source ?? 'all', ...(savedKind !== 'all' ? { p_saved_kind: savedKind } : {}) } : { p_mode: 'list' }),
      p_limit: limit, p_filter: filter, p_before: after?.created_at ?? null, p_before_id: after?.id ?? null,
    });
    return { items: result.items.map(item), nextCursor: result.cursor ? Buffer.from(JSON.stringify(result.cursor)).toString('base64url') : null, counts: readFindCounts(result.counts) };
  }
  async sourceSummaries(userId: string, query: { kind?: unknown; cursor?: unknown; limit?: unknown } = {}): Promise<FindSourceSummaryPage> {
    const kind = query.kind ?? 'product', limit = query.limit === undefined ? 20 : Number(query.limit);
    if (kind !== 'product' && kind !== 'place') throw new ShareError('invalid_source_kind');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ShareError('invalid_limit');
    const after = parseHistoryCursor(query.cursor);
    const result = await this.rpc<{ items: FindSourceSummaryPage['items']; cursor: unknown }>('find_source_summaries', {
      p_user: userId,p_kind: kind,p_limit: limit,p_before: after?.created_at ?? null,p_before_id: after?.id ?? null });
    return { items: result.items, nextCursor: result.cursor ? Buffer.from(JSON.stringify(result.cursor)).toString('base64url') : null };
  }
  async sourceResults(userId: string, id: string, query: { cursor?: unknown; limit?: unknown } = {}): Promise<FindSourceResultPage> {
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ShareError('invalid_limit');
    let after: string | null = null;
    if (query.cursor !== undefined) {
      if (typeof query.cursor !== 'string' || query.cursor.length > 200) throw new ShareError('invalid_cursor');
      try { const parsed = JSON.parse(Buffer.from(query.cursor,'base64url').toString());
        if (!parsed || typeof parsed.key !== 'string' || !/^(?:place:[0-9a-f-]{36}|product:[cd]:[0-9a-f-]{36})$/.test(parsed.key)) throw Error();
        after = parsed.key;
      } catch { throw new ShareError('invalid_cursor'); }
    }
    const result = await this.rpc<{ items: FindSourceResultPage['items']; cursor: string | null }>('find_source_results', {
      p_user:userId,p_import:findId(id),p_limit:limit,p_after:after });
    const kept=new Set((await this.visiblePlaces(result.items.filter(r=>r.kind==='place').map(r=>r.result as FindPlace))).map(p=>p.id));
    return { items: result.items.filter(row=>row.kind!=='place'||kept.has(row.result.id)),nextCursor:result.cursor ? Buffer.from(JSON.stringify({key:result.cursor})).toString('base64url') : null };
  }
  async counts(userId: string): Promise<FindCounts> {
    return readFindCounts((await this.rpc<{ counts: FindCounts }>('find_query', { p_user: userId, p_mode: 'counts' })).counts);
  }
  async batch(userId: string, value: unknown): Promise<FindBatch> {
    const ids = findBatchIds(value);
    const result = await this.rpc<{ items: unknown[] }>('find_query', { p_user: userId, p_mode: 'batch', p_ids: ids });
    const items = result.items.map(item), found = new Set(items.map(row => row.id));
    return { items, unavailableIds: ids.filter(id => !found.has(id)) };
  }
  async detail(userId: string, id: string): Promise<FindDetail> {
    const result = await this.rpc<FindDetail>('find_detail', { p_user: userId, p_import: findId(id) });
    return { ...result, ...item(result),places:await this.visiblePlaces(result.places) };
  }
  private async visiblePlaces(rows:FindPlace[]):Promise<FindPlace[]> {
    if(!rows.length)return rows;
    const metadata=new Map<string,PlaceMentionIdentity>();
    // IDs originate exclusively from the user-authorized RPC result.
    if(typeof this.db.from==='function') {
      const {data,error}=await this.db.from('content_source_places').select('id,extracted_name,category,locality,city,region,country,mentioned_address,evidence').in('id',rows.map(r=>r.id));
      if(error)throw new ShareError('find_unavailable',503);
      for(const row of data??[])metadata.set(row.id,{...row,name:row.extracted_name,mentionedAddress:row.mentioned_address});
    }
    const out:FindPlace[]=[];
    for(const row of rows) {
      const fields=metadata.get(row.id)??row;
      if(isGeographyOnly(fields))continue;
      if(out.some(other=>row.placeId?other.placeId===row.placeId:!other.placeId&&samePlaceMention(metadata.get(other.id)??other,fields)))continue;
      out.push(row);
    }
    return out;
  }
  async resultAction(userId: string, id: string, kind: 'product' | 'place', resultId: string, restore: boolean, expectedIdentity?: unknown, candidateKey?: string): Promise<{ ok: true; saved: boolean }> {
    if (kind === 'product' && (typeof expectedIdentity !== 'string' || !/^[cd]:/.test(expectedIdentity) || !uuid.test(expectedIdentity.slice(2)))) throw new ShareError('invalid_product_identity');
    return this.rpc('find_result_action', { p_user: userId, p_import: findId(id), p_kind: kind, p_result: findId(resultId), p_restore: restore, p_expected: expectedIdentity ?? null, p_candidate: candidateKey ?? null });
  }
}
