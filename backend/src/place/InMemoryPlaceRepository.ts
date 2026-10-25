import { randomUUID } from 'node:crypto';
import { placeHypothesisKey } from './domain/hypothesisKey';
import type {
  ContentSourcePlaceRecord,
  InsertPlaceLeadRow,
  InsertPlaceRow,
  InsertUnresolvedHypothesisRow,
  PlaceRecord,
  UpgradePlaceLeadResult,
  UserPlaceSaveRecord,
} from './domain/types';
import type { PlaceSourceMedia } from './placeListImage';
import { PlaceRepositoryError, type PlaceRepository } from './PlaceRepository';

function now(): string {
  return new Date().toISOString();
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new PlaceRepositoryError(`${label} required`, 'invalid');
  return trimmed;
}

export class InMemoryPlaceRepository implements PlaceRepository {
  places = new Map<string, PlaceRecord>();
  hypotheses = new Map<string, ContentSourcePlaceRecord>();
  saves = new Map<string, UserPlaceSaveRecord>();
  sourceMedia = new Map<string, PlaceSourceMedia>();

  async insertPlace(row: InsertPlaceRow): Promise<PlaceRecord> {
    const provider = requireText(row.provider, 'provider');
    const providerPlaceId = requireText(row.providerPlaceId, 'providerPlaceId');
    const name = requireText(row.name, 'name');
    if (await this.findPlaceByProviderId(provider, providerPlaceId)) {
      throw new PlaceRepositoryError('canonical place already exists', 'duplicate');
    }
    const ts = now();
    const record: PlaceRecord = {
      id: randomUUID(),
      provider,
      providerPlaceId,
      name,
      locality: blank(row.locality),
      city: blank(row.city),
      region: blank(row.region),
      country: blank(row.country),
      category: blank(row.category),
      formattedAddress: blank(row.formattedAddress),
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      mapsUrl: blank(row.mapsUrl),
      createdAt: ts,
      updatedAt: ts,
      schemaVersion: 1,
    };
    this.places.set(record.id, record);
    return { ...record };
  }

  async findPlaceById(id: string): Promise<PlaceRecord | null> {
    const row = this.places.get(id);
    return row ? { ...row } : null;
  }

  async findPlaceByProviderId(provider: string, providerPlaceId: string): Promise<PlaceRecord | null> {
    for (const row of this.places.values()) {
      if (row.provider === provider && row.providerPlaceId === providerPlaceId) return { ...row };
    }
    return null;
  }

  async insertHypothesis(row: InsertUnresolvedHypothesisRow): Promise<ContentSourcePlaceRecord> {
    const key = this.keyFor(row);
    if (await this.findHypothesis(row.contentSourceId, key)) {
      throw new PlaceRepositoryError('place hypothesis already exists', 'duplicate');
    }
    return this.writeHypothesis(row, key, null);
  }

  async findHypothesis(
    contentSourceId: string,
    hypothesisKey: string,
  ): Promise<ContentSourcePlaceRecord | null> {
    for (const row of this.hypotheses.values()) {
      if (row.contentSourceId === contentSourceId && row.hypothesisKey === hypothesisKey) {
        return this.copyHypothesis(row);
      }
    }
    return null;
  }

  async findHypothesisById(id: string): Promise<ContentSourcePlaceRecord | null> {
    const row = this.hypotheses.get(id);
    return row ? this.copyHypothesis(row) : null;
  }

  async listHypotheses(contentSourceId: string): Promise<ContentSourcePlaceRecord[]> {
    return [...this.hypotheses.values()]
      .filter((row) => row.contentSourceId === contentSourceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((row) => this.copyHypothesis(row));
  }

  async upsertHypothesis(row: InsertUnresolvedHypothesisRow): Promise<ContentSourcePlaceRecord> {
    const key = this.keyFor(row);
    const existing = await this.findHypothesis(row.contentSourceId, key);
    if (!existing) return this.writeHypothesis(row, key, null);
    const ts = now();
    const next: ContentSourcePlaceRecord = {
      ...existing,
      extractedName: requireText(row.extractedName, 'extractedName'),
      category: blank(row.category),
      locality: blank(row.locality),
      city: blank(row.city),
      region: blank(row.region),
      country: blank(row.country),
      mentionedAddress: blank(row.mentionedAddress),
      confidence: row.confidence ?? null,
      evidence: { ...(row.evidence ?? {}) },
      sources: [...(row.sources ?? [])],
      unresolvedReason: existing.resolutionState === 'resolved' ? existing.unresolvedReason : row.unresolvedReason,
      updatedAt: ts,
    };
    this.hypotheses.set(existing.id, next);
    return this.copyHypothesis(next);
  }

  async markHypothesisResolved(id: string, placeId: string): Promise<ContentSourcePlaceRecord> {
    const existing = this.hypotheses.get(id);
    if (!existing) throw new PlaceRepositoryError('place hypothesis not found', 'not_found');
    const place = await this.findPlaceById(placeId);
    if (!place) throw new PlaceRepositoryError('canonical place not found', 'invalid');
    if (existing.placeId && existing.placeId !== placeId) {
      throw new PlaceRepositoryError('hypothesis already resolved to a different place', 'invalid');
    }
    const next: ContentSourcePlaceRecord = {
      ...existing,
      resolutionState: 'resolved',
      unresolvedReason: null,
      placeId,
      updatedAt: now(),
    };
    this.hypotheses.set(id, next);
    return this.copyHypothesis(next);
  }

  async insertLead(row: InsertPlaceLeadRow): Promise<UserPlaceSaveRecord> {
    const hypothesis = this.hypotheses.get(row.contentSourcePlaceId);
    if (!hypothesis) throw new PlaceRepositoryError('place hypothesis not found', 'invalid');
    if (hypothesis.contentSourceId !== row.contentSourceId) {
      throw new PlaceRepositoryError('content source does not match hypothesis', 'invalid');
    }
    if (await this.findSaveByUserAndHypothesis(row.userId, row.contentSourcePlaceId)) {
      throw new PlaceRepositoryError('place lead already exists', 'duplicate');
    }
    if (hypothesis.placeId && (await this.findSaveByUserAndPlace(row.userId, hypothesis.placeId))) {
      throw new PlaceRepositoryError('canonical place already saved', 'duplicate');
    }
    const ts = now();
    const record: UserPlaceSaveRecord = {
      id: randomUUID(),
      userId: row.userId,
      contentSourcePlaceId: row.contentSourcePlaceId,
      placeId: hypothesis.placeId,
      contentSourceId: row.contentSourceId,
      userImportId: row.userImportId,
      createdAt: ts,
      updatedAt: ts,
      schemaVersion: 1,
    };
    this.saves.set(record.id, record);
    return { ...record };
  }

  async findSaveByUserAndHypothesis(
    userId: string,
    contentSourcePlaceId: string,
  ): Promise<UserPlaceSaveRecord | null> {
    for (const row of this.saves.values()) {
      if (row.userId === userId && row.contentSourcePlaceId === contentSourcePlaceId) return { ...row };
    }
    return null;
  }

  async findSaveByUserAndPlace(userId: string, placeId: string): Promise<UserPlaceSaveRecord | null> {
    for (const row of this.saves.values()) {
      if (row.userId === userId && row.placeId === placeId) return { ...row };
    }
    return null;
  }

  setSourceMedia(contentSourceId: string, media: PlaceSourceMedia): void {
    this.sourceMedia.set(contentSourceId, media);
  }

  async findSourceMedia(contentSourceId: string): Promise<PlaceSourceMedia> {
    return this.sourceMedia.get(contentSourceId) ?? { sourceThumbnailUrl: null, frameUrl: null };
  }

  async listSavesByUser(userId: string): Promise<UserPlaceSaveRecord[]> {
    return [...this.saves.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({ ...row }));
  }

  async countByUserImport(userImportId: string): Promise<number> {
    let count = 0;
    for (const row of this.saves.values()) {
      if (row.userImportId === userImportId) count += 1;
    }
    return count;
  }

  async upgradeLead(saveId: string, placeId: string): Promise<UpgradePlaceLeadResult> {
    const save = this.saves.get(saveId);
    if (!save) throw new PlaceRepositoryError('place save not found', 'not_found');
    await this.markHypothesisResolved(save.contentSourcePlaceId, placeId);
    const existing = await this.findSaveByUserAndPlace(save.userId, placeId);
    if (existing && existing.id !== save.id) {
      this.saves.delete(save.id);
      return { save: existing, merged: true };
    }
    const next: UserPlaceSaveRecord = { ...save, placeId, updatedAt: now() };
    this.saves.set(save.id, next);
    return { save: { ...next }, merged: false };
  }

  async deleteUnresolvedExcept(contentSourceId: string, keepKeys: string[]): Promise<number> {
    const keep = new Set(keepKeys);
    const remove = [...this.hypotheses.values()].filter(
      (row) =>
        row.contentSourceId === contentSourceId &&
        row.resolutionState === 'unresolved' &&
        !keep.has(row.hypothesisKey),
    );
    for (const row of remove) {
      this.hypotheses.delete(row.id);
      for (const save of [...this.saves.values()]) {
        if (save.contentSourcePlaceId === row.id) this.saves.delete(save.id);
      }
    }
    return remove.length;
  }

  private keyFor(row: InsertUnresolvedHypothesisRow): string {
    requireText(row.extractedName, 'extractedName');
    requireText(row.contentSourceId, 'contentSourceId');
    return placeHypothesisKey(row);
  }

  private writeHypothesis(
    row: InsertUnresolvedHypothesisRow,
    hypothesisKey: string,
    id: string | null,
  ): ContentSourcePlaceRecord {
    const ts = now();
    const record: ContentSourcePlaceRecord = {
      id: id ?? randomUUID(),
      contentSourceId: row.contentSourceId,
      extractedName: requireText(row.extractedName, 'extractedName'),
      category: blank(row.category),
      locality: blank(row.locality),
      city: blank(row.city),
      region: blank(row.region),
      country: blank(row.country),
      mentionedAddress: blank(row.mentionedAddress),
      confidence: row.confidence ?? null,
      evidence: { ...(row.evidence ?? {}) },
      sources: [...(row.sources ?? [])],
      resolutionState: 'unresolved',
      unresolvedReason: row.unresolvedReason,
      placeId: null,
      hypothesisKey,
      createdAt: ts,
      updatedAt: ts,
      schemaVersion: 1,
    };
    this.hypotheses.set(record.id, record);
    return this.copyHypothesis(record);
  }

  private copyHypothesis(row: ContentSourcePlaceRecord): ContentSourcePlaceRecord {
    return { ...row, evidence: { ...row.evidence }, sources: [...row.sources] };
  }
}
