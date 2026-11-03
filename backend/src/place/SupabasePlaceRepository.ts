import type { SupabaseClient } from '@supabase/supabase-js';
import { placeHypothesisKey } from './domain/hypothesisKey';
import type {
  ContentSourcePlaceRecord,
  InsertPlaceLeadRow,
  InsertPlaceRow,
  InsertUnresolvedHypothesisRow,
  PlaceRecord,
  PlaceSaveSource,
  PlaceResolutionState,
  PlaceUnresolvedReason,
  UpgradePlaceLeadResult,
  UserPlaceSaveRecord,
} from './domain/types';
import type { PlaceSourceMedia } from './placeListImage';
import { PlaceRepositoryError, type PlaceRepository, type PlaceStashSnapshot } from './PlaceRepository';

type Row = Record<string, unknown>;

const UNRESOLVED_REASONS = new Set<PlaceUnresolvedReason>([
  'name_not_distinctive',
  'ambiguous',
  'no_results',
  'provider_failed',
  'locality_conflict',
  'category_conflict',
  'pending_resolution',
]);

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new PlaceRepositoryError(`${label} required`, 'invalid');
  return trimmed;
}

function asReason(value: unknown): PlaceUnresolvedReason | null {
  return typeof value === 'string' && UNRESOLVED_REASONS.has(value as PlaceUnresolvedReason)
    ? (value as PlaceUnresolvedReason)
    : null;
}

function asState(value: unknown): PlaceResolutionState {
  return value === 'resolved' ? 'resolved' : 'unresolved';
}

function mapPlace(row: Row): PlaceRecord {
  return {
    id: String(row.id),
    provider: String(row.provider),
    providerPlaceId: String(row.provider_place_id),
    name: String(row.name),
    locality: (row.locality as string) ?? null,
    city: (row.city as string) ?? null,
    region: (row.region as string) ?? null,
    country: (row.country as string) ?? null,
    category: (row.category as string) ?? null,
    formattedAddress: (row.formatted_address as string) ?? null,
    latitude: typeof row.latitude === 'number' ? row.latitude : null,
    longitude: typeof row.longitude === 'number' ? row.longitude : null,
    mapsUrl: (row.maps_url as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    schemaVersion: Number(row.schema_version ?? 1),
  };
}

function mapHypothesis(row: Row): ContentSourcePlaceRecord {
  const sources = Array.isArray(row.sources) ? row.sources.filter((item) => typeof item === 'string') : [];
  const evidence =
    row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
      ? (row.evidence as Record<string, unknown>)
      : {};
  const confidenceNumber =
    row.confidence == null || row.confidence === '' ? null : Number(row.confidence);
  return {
    id: String(row.id),
    contentSourceId: String(row.content_source_id),
    retiredAt: (row.retired_at as string) ?? null,
    extractedName: String(row.extracted_name),
    category: (row.category as string) ?? null,
    locality: (row.locality as string) ?? null,
    city: (row.city as string) ?? null,
    region: (row.region as string) ?? null,
    country: (row.country as string) ?? null,
    mentionedAddress: (row.mentioned_address as string) ?? null,
    confidence: confidenceNumber != null && Number.isFinite(confidenceNumber) ? confidenceNumber : null,
    evidence,
    sources,
    resolutionState: asState(row.resolution_state),
    unresolvedReason: asReason(row.unresolved_reason),
    placeId: (row.place_id as string) ?? null,
    hypothesisKey: String(row.hypothesis_key),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    schemaVersion: Number(row.schema_version ?? 1),
  };
}

function mapSave(row: Row): UserPlaceSaveRecord {
  return {
    removedAt: (row.removed_at as string) ?? null, explicitActionAt: (row.explicit_action_at as string) ?? null,
    id: String(row.id),
    userId: String(row.user_id),
    contentSourcePlaceId: String(row.content_source_place_id),
    placeId: (row.place_id as string) ?? null,
    contentSourceId: String(row.content_source_id),
    userImportId: String(row.user_import_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    schemaVersion: Number(row.schema_version ?? 1),
  };
}

function throwMapped(error: { code?: string; message?: string }, duplicateMessage: string): never {
  if (error.code === '23505') throw new PlaceRepositoryError(duplicateMessage, 'duplicate');
  if (error.code === '23514') throw new PlaceRepositoryError(error.message ?? 'invalid place row', 'invalid');
  throw new Error(error.message ?? 'place repository failed');
}

const READ_PAGE_SIZE = 500;
const ID_BATCH_SIZE = 80;
type ReadResult = { data: unknown; error: { message: string } | null };

/** PostgREST's row cap must not silently truncate saves or provenance. */
async function readAll(build: (from: number, to: number) => PromiseLike<ReadResult>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += READ_PAGE_SIZE) {
    const { data, error } = await build(offset, offset + READ_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = Array.isArray(data) ? data as Row[] : [];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += ID_BATCH_SIZE) result.push(values.slice(i, i + ID_BATCH_SIZE));
  return result;
}

function mediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export class SupabasePlaceRepository implements PlaceRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async setMembership(userId: string, saveId: string, restore: boolean): Promise<UserPlaceSaveRecord> {
    const { data, error } = await this.admin.rpc('find_place_membership', { p_user: userId, p_save: saveId, p_restore: restore });
    if (error?.code === 'P0002') throw new PlaceRepositoryError('Place save not found', 'not_found');
    if (error?.code === '23514') throw new PlaceRepositoryError('Place save unavailable', 'invalid');
    if (error || !data) throw new Error('Place membership storage unavailable');
    return mapSave(data as Row);
  }

  async loadStash(userId: string): Promise<PlaceStashSnapshot> {
    const [saveRows, sourceRows] = await Promise.all([
      readAll((from, to) => {
        let query = this.admin.from('user_place_saves').select('*').eq('user_id', userId);
        query = query.is('removed_at', null);
        return query
        .order('created_at', { ascending: false }).order('id').range(from, to); }),
      readAll((from, to) => this.admin.from('user_place_save_sources').select('*').eq('user_id', userId)
        .order('created_at').order('id').range(from, to)),
    ]);
    const saves = saveRows.map(mapSave);
    const saveIds = new Set(saves.map(s => s.id));
    const sources = sourceRows.filter(r => saveIds.has(String(r.save_id))).map(row => ({
      saveId: String(row.save_id), userId, contentSourcePlaceId: String(row.content_source_place_id),
      contentSourceId: String(row.content_source_id), userImportId: String(row.user_import_id), createdAt: String(row.created_at),
    }));
    const readIds = async (table: string, ids: string[]) => {
      const rows: Row[] = [];
      for (const batch of chunks([...new Set(ids)])) {
        rows.push(...await readAll((from, to) => this.admin.from(table).select('*').in('id', batch).order('id').range(from, to)));
      }
      return rows;
    };
    const [hypotheses, places, media] = await Promise.all([
      readIds('content_source_places', saves.map(s => s.contentSourcePlaceId)),
      readIds('places', saves.flatMap(s => s.placeId ? [s.placeId] : [])),
      this.findSourceMediaBatch([...saves.map(s => s.contentSourceId), ...sources.map(s => s.contentSourceId)]),
    ]);
    return { saves, sources, hypotheses: hypotheses.map(mapHypothesis), places: places.map(mapPlace), media };
  }

  /** Only stored metadata is read. Historical fallback never repairs data on GET. */
  private async findSourceMediaBatch(sourceIds: string[]): Promise<Map<string, PlaceSourceMedia>> {
    const media = new Map<string, PlaceSourceMedia>();
    for (const batch of chunks([...new Set(sourceIds)])) {
      const rows = await readAll((from, to) => this.admin.from('content_sources')
        .select('id,platform,external_id,canonical_url,thumbnail_url').in('id', batch).order('id').range(from, to));
      const missing = rows.filter(r => !mediaUrl(r.thumbnail_url));
      const cached = new Map<string, string>();
      // Prefer the newest available metadata for the exact platform/video identity.
      // Select only metadata, never the large product/evidence payload.
      for (const platform of new Set(missing.map(r => String(r.platform)))) {
        const ids = missing.filter(r => r.platform === platform).map(r => String(r.external_id));
        const cacheRows = await readAll((from, to) => this.admin.from('video_extraction_cache')
          .select('external_video_id,metadata:payload->youtubeMetadata,updated_at,cache_key')
          .eq('platform', platform).in('external_video_id', ids)
          .order('updated_at', { ascending: false }).order('cache_key').range(from, to)).catch(() => []);
        for (const row of cacheRows) {
          const key = `${platform}:${row.external_video_id}`;
          const metadata = row.metadata as { thumbnailUrl?: unknown } | null;
          const url = mediaUrl(metadata?.thumbnailUrl);
          if (url && !cached.has(key)) cached.set(key, url);
        }
      }
      const urls = [...new Set(missing.filter(r => !cached.has(`${r.platform}:${r.external_id}`))
        .map(r => mediaUrl(r.canonical_url)).filter((url): url is string => Boolean(url)))];
      const videos = urls.length ? await readAll((from, to) => this.admin.from('videos')
        .select('id,url,embed_url,thumbnail').or(`url.in.(${urls.map(url => JSON.stringify(url)).join(',')}),embed_url.in.(${urls.map(url => JSON.stringify(url)).join(',')})`)
        .order('id').range(from, to)).catch(() => []) : [];
      for (const row of rows) {
        const sourceUrl = mediaUrl(row.canonical_url);
        const video = videos.find(v => (v.url === sourceUrl || v.embed_url === sourceUrl) && mediaUrl(v.thumbnail));
        media.set(String(row.id), { sourceUrl,
          // videos.thumbnail is a source poster, not proof of an extracted venue frame.
          sourceThumbnailUrl: mediaUrl(row.thumbnail_url) ?? cached.get(`${row.platform}:${row.external_id}`) ?? mediaUrl(video?.thumbnail),
          frameUrl: null,
        });
      }
    }
    return media;
  }

  async insertPlace(row: InsertPlaceRow): Promise<PlaceRecord> {
    const { data, error } = await this.admin
      .from('places')
      .insert({
        provider: requireText(row.provider, 'provider'),
        provider_place_id: requireText(row.providerPlaceId, 'providerPlaceId'),
        name: requireText(row.name, 'name'),
        locality: blank(row.locality),
        city: blank(row.city),
        region: blank(row.region),
        country: blank(row.country),
        category: blank(row.category),
        formatted_address: blank(row.formattedAddress),
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        maps_url: blank(row.mapsUrl),
      })
      .select('*')
      .single();
    if (error || !data) throwMapped(error ?? {}, 'canonical place already exists');
    return mapPlace(data as Row);
  }

  async findPlaceById(id: string): Promise<PlaceRecord | null> {
    const { data, error } = await this.admin.from('places').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapPlace(data as Row) : null;
  }

  async findPlaceByProviderId(provider: string, providerPlaceId: string): Promise<PlaceRecord | null> {
    const { data, error } = await this.admin
      .from('places')
      .select('*')
      .eq('provider', provider)
      .eq('provider_place_id', providerPlaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapPlace(data as Row) : null;
  }

  async insertHypothesis(row: InsertUnresolvedHypothesisRow): Promise<ContentSourcePlaceRecord> {
    const { data, error } = await this.admin
      .from('content_source_places')
      .insert(this.hypothesisInsert(row))
      .select('*')
      .single();
    if (error || !data) throwMapped(error ?? {}, 'place hypothesis already exists');
    return mapHypothesis(data as Row);
  }

  async findHypothesis(
    contentSourceId: string,
    hypothesisKey: string,
  ): Promise<ContentSourcePlaceRecord | null> {
    const { data, error } = await this.admin
      .from('content_source_places')
      .select('*')
      .eq('content_source_id', contentSourceId)
      .eq('hypothesis_key', hypothesisKey)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapHypothesis(data as Row) : null;
  }

  async findHypothesisById(id: string): Promise<ContentSourcePlaceRecord | null> {
    return this.hypothesisById(id);
  }

  async listHypotheses(contentSourceId: string): Promise<ContentSourcePlaceRecord[]> {
    let query = this.admin.from('content_source_places').select('*').eq('content_source_id', contentSourceId);
    query = query.is('retired_at', null);
    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => mapHypothesis(row as Row));
  }

  async upsertHypothesis(row: InsertUnresolvedHypothesisRow): Promise<ContentSourcePlaceRecord> {
    const { data, error } = await this.admin.rpc('place_upsert_hypothesis', { p_row: this.hypothesisInsert(row) });
    if (error || !data) throwMapped(error ?? {}, 'place hypothesis conflict');
    return mapHypothesis(data as Row);
  }

  async resolveHypothesis(row: InsertUnresolvedHypothesisRow, place: InsertPlaceRow): Promise<ContentSourcePlaceRecord> {
    const { data, error } = await this.admin.rpc('place_resolve_hypothesis', {
      p_row: this.hypothesisInsert(row),
      p_place: {
        provider: place.provider, provider_place_id: place.providerPlaceId, name: place.name,
        locality: blank(place.locality), city: blank(place.city), region: blank(place.region), country: blank(place.country),
        category: blank(place.category), formatted_address: blank(place.formattedAddress),
        latitude: place.latitude ?? null, longitude: place.longitude ?? null, maps_url: blank(place.mapsUrl),
      },
    });
    if (error || !data) throwMapped(error ?? {}, 'place resolution conflict');
    return mapHypothesis(data as Row);
  }

  async markHypothesisResolved(id: string, placeId: string): Promise<ContentSourcePlaceRecord> {
    const { data, error } = await this.admin.rpc('place_mark_resolved', { p_hypothesis_id: id, p_place_id: placeId });
    if (error || !data) throwMapped(error ?? {}, 'place hypothesis conflict');
    return mapHypothesis(data as Row);
  }

  async insertLead(row: InsertPlaceLeadRow): Promise<UserPlaceSaveRecord> {
    const { data, error } = await this.admin.rpc('place_attach_import', {
      p_user_id: row.userId, p_hypothesis_id: row.contentSourcePlaceId,
      p_source_id: row.contentSourceId, p_import_id: row.userImportId,
    });
    if (error || !data) throwMapped(error ?? {}, 'place save conflict');
    return mapSave(data as Row);
  }

  async listSourcesByUser(userId: string): Promise<PlaceSaveSource[]> {
    const rows = await readAll((from, to) => this.admin.from('user_place_save_sources').select('*')
      .eq('user_id', userId).order('created_at', { ascending: true }).order('id').range(from, to));
    return rows.map(row => ({ saveId: String(row.save_id), userId: String(row.user_id),
      contentSourcePlaceId: String(row.content_source_place_id), contentSourceId: String(row.content_source_id),
      userImportId: String(row.user_import_id), createdAt: String(row.created_at) }));
  }

  async findSaveByUserAndHypothesis(
    userId: string,
    contentSourcePlaceId: string,
  ): Promise<UserPlaceSaveRecord | null> {
    const { data, error } = await this.admin.from('user_place_save_sources')
      .select('user_place_saves(*)').eq('user_id', userId).eq('content_source_place_id', contentSourcePlaceId).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.user_place_saves ? mapSave(data.user_place_saves as unknown as Row) : null;
  }

  async findSaveByUserAndPlace(userId: string, placeId: string): Promise<UserPlaceSaveRecord | null> {
    const { data, error } = await this.admin
      .from('user_place_saves')
      .select('*')
      .eq('user_id', userId)
      .eq('place_id', placeId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapSave(data as Row) : null;
  }

  async listSavesByUser(userId: string): Promise<UserPlaceSaveRecord[]> {
    const rows = await readAll((from, to) => {
      let query = this.admin.from('user_place_saves').select('*').eq('user_id', userId);
      query = query.is('removed_at', null);
      return query.order('created_at', { ascending: false }).order('id').range(from, to);
    });
    return rows.map(mapSave);
  }

  async countByUserImport(userImportId: string): Promise<number> {
    const { data, error } = await this.admin.from('user_place_save_sources').select('save_id').eq('user_import_id', userImportId);
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((row) => row.save_id)).size;
  }

  async upgradeLead(saveId: string, placeId: string): Promise<UpgradePlaceLeadResult> {
    const { data, error } = await this.admin.rpc('place_upgrade_save', { p_save_id: saveId, p_place_id: placeId });
    if (error || !data) throwMapped(error ?? {}, 'place save conflict');
    return { save: mapSave(data.save as Row), merged: data.merged === true };
  }

  async deleteUnresolvedExcept(contentSourceId: string, keepKeys: string[]): Promise<number> {
    const { data, error } = await this.admin.rpc('find_retire_place_hypotheses', { p_source: contentSourceId, p_keep: keepKeys });
    if (error) throw new Error('Place evidence could not be retired');
    return Number(data);
  }

  async findSourceMedia(contentSourceId: string): Promise<PlaceSourceMedia> {
    return (await this.findSourceMediaBatch([contentSourceId])).get(contentSourceId)
      ?? { sourceUrl: null, sourceThumbnailUrl: null, frameUrl: null };
  }

  private hypothesisInsert(row: InsertUnresolvedHypothesisRow) {
    return {
      content_source_id: requireText(row.contentSourceId, 'contentSourceId'),
      extracted_name: requireText(row.extractedName, 'extractedName'),
      category: blank(row.category),
      locality: blank(row.locality),
      city: blank(row.city),
      region: blank(row.region),
      country: blank(row.country),
      mentioned_address: blank(row.mentionedAddress),
      confidence: row.confidence ?? null,
      evidence: row.evidence ?? {},
      sources: row.sources ?? [],
      resolution_state: 'unresolved',
      unresolved_reason: row.unresolvedReason,
      place_id: null,
      hypothesis_key: placeHypothesisKey(row),
    };
  }

  private async hypothesisById(id: string): Promise<ContentSourcePlaceRecord | null> {
    const { data, error } = await this.admin
      .from('content_source_places')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapHypothesis(data as Row) : null;
  }

}
