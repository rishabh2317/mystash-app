import type { SupabaseClient } from '@supabase/supabase-js';
import { placeHypothesisKey } from './domain/hypothesisKey';
import type {
  ContentSourcePlaceRecord,
  InsertPlaceLeadRow,
  InsertPlaceRow,
  InsertUnresolvedHypothesisRow,
  PlaceRecord,
  PlaceResolutionState,
  PlaceUnresolvedReason,
  UpgradePlaceLeadResult,
  UserPlaceSaveRecord,
} from './domain/types';
import type { PlaceSourceMedia } from './placeListImage';
import { PlaceRepositoryError, type PlaceRepository } from './PlaceRepository';

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

export class SupabasePlaceRepository implements PlaceRepository {
  constructor(private readonly admin: SupabaseClient) {}

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
    const { data, error } = await this.admin
      .from('content_source_places')
      .select('*')
      .eq('content_source_id', contentSourceId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => mapHypothesis(row as Row));
  }

  async upsertHypothesis(row: InsertUnresolvedHypothesisRow): Promise<ContentSourcePlaceRecord> {
    const key = placeHypothesisKey(row);
    const existing = await this.findHypothesis(row.contentSourceId, key);
    if (!existing) return this.insertHypothesis(row);
    const { data, error } = await this.admin
      .from('content_source_places')
      .update({
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
        ...(existing.resolutionState === 'unresolved'
          ? { unresolved_reason: row.unresolvedReason }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to update place hypothesis');
    return mapHypothesis(data as Row);
  }

  async markHypothesisResolved(id: string, placeId: string): Promise<ContentSourcePlaceRecord> {
    const place = await this.findPlaceById(placeId);
    if (!place) throw new PlaceRepositoryError('canonical place not found', 'invalid');
    const current = await this.hypothesisById(id);
    if (!current) throw new PlaceRepositoryError('place hypothesis not found', 'not_found');
    if (current.placeId && current.placeId !== placeId) {
      throw new PlaceRepositoryError('hypothesis already resolved to a different place', 'invalid');
    }
    if (current.placeId === placeId && current.resolutionState === 'resolved') return current;
    const { data, error } = await this.admin
      .from('content_source_places')
      .update({
        resolution_state: 'resolved',
        unresolved_reason: null,
        place_id: placeId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throwMapped(error ?? {}, 'place hypothesis conflict');
    return mapHypothesis(data as Row);
  }

  async insertLead(row: InsertPlaceLeadRow): Promise<UserPlaceSaveRecord> {
    const hypothesis = await this.hypothesisById(row.contentSourcePlaceId);
    if (!hypothesis) throw new PlaceRepositoryError('place hypothesis not found', 'invalid');
    if (hypothesis.contentSourceId !== row.contentSourceId) {
      throw new PlaceRepositoryError('content source does not match hypothesis', 'invalid');
    }
    if (hypothesis.placeId && (await this.findSaveByUserAndPlace(row.userId, hypothesis.placeId))) {
      throw new PlaceRepositoryError('canonical place already saved', 'duplicate');
    }
    const { data, error } = await this.admin
      .from('user_place_saves')
      .insert({
        user_id: row.userId,
        content_source_place_id: row.contentSourcePlaceId,
        place_id: hypothesis.placeId,
        content_source_id: row.contentSourceId,
        user_import_id: row.userImportId,
      })
      .select('*')
      .single();
    if (error || !data) throwMapped(error ?? {}, 'place lead already exists');
    return mapSave(data as Row);
  }

  async findSaveByUserAndHypothesis(
    userId: string,
    contentSourcePlaceId: string,
  ): Promise<UserPlaceSaveRecord | null> {
    const { data, error } = await this.admin
      .from('user_place_saves')
      .select('*')
      .eq('user_id', userId)
      .eq('content_source_place_id', contentSourcePlaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapSave(data as Row) : null;
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
    const { data, error } = await this.admin
      .from('user_place_saves')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => mapSave(row as Row));
  }

  async countByUserImport(userImportId: string): Promise<number> {
    const { count, error } = await this.admin
      .from('user_place_saves')
      .select('id', { count: 'exact', head: true })
      .eq('user_import_id', userImportId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async upgradeLead(saveId: string, placeId: string): Promise<UpgradePlaceLeadResult> {
    const save = await this.saveById(saveId);
    if (!save) throw new PlaceRepositoryError('place save not found', 'not_found');
    await this.markHypothesisResolved(save.contentSourcePlaceId, placeId);
    const existing = await this.findSaveByUserAndPlace(save.userId, placeId);
    if (existing && existing.id !== save.id) {
      const { error } = await this.admin.from('user_place_saves').delete().eq('id', save.id);
      if (error) throw new Error(error.message);
      return { save: existing, merged: true };
    }
    const { data, error } = await this.admin
      .from('user_place_saves')
      .update({ place_id: placeId, updated_at: new Date().toISOString() })
      .eq('id', save.id)
      .select('*')
      .single();
    if (error || !data) throwMapped(error ?? {}, 'canonical place already saved');
    return { save: mapSave(data as Row), merged: false };
  }

  async deleteUnresolvedExcept(contentSourceId: string, keepKeys: string[]): Promise<number> {
    const keep = new Set(keepKeys);
    const existing = await this.listHypotheses(contentSourceId);
    const remove = existing.filter(
      (row) => row.resolutionState === 'unresolved' && !keep.has(row.hypothesisKey),
    );
    if (remove.length === 0) return 0;
    const { error } = await this.admin
      .from('content_source_places')
      .delete()
      .in(
        'id',
        remove.map((row) => row.id),
      );
    if (error) throw new Error(error.message);
    return remove.length;
  }

  async findSourceMedia(contentSourceId: string): Promise<PlaceSourceMedia> {
    const { data: source, error } = await this.admin
      .from('content_sources')
      .select('thumbnail_url, canonical_url')
      .eq('id', contentSourceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const sourceThumbnailUrl = blank(source?.thumbnail_url as string | undefined);
    const canonical = blank(source?.canonical_url as string | undefined);
    let frameUrl: string | null = null;
    if (canonical) {
      const byUrl = await this.admin.from('videos').select('thumbnail').eq('url', canonical).maybeSingle();
      frameUrl = blank(byUrl.data?.thumbnail as string | undefined);
      if (!frameUrl) {
        const byEmbed = await this.admin
          .from('videos')
          .select('thumbnail')
          .eq('embed_url', canonical)
          .maybeSingle();
        frameUrl = blank(byEmbed.data?.thumbnail as string | undefined);
      }
    }
    return { sourceThumbnailUrl, frameUrl };
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

  private async saveById(id: string): Promise<UserPlaceSaveRecord | null> {
    const { data, error } = await this.admin.from('user_place_saves').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapSave(data as Row) : null;
  }
}
