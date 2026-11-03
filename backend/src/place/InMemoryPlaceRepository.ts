import { assertImportWorkActive } from '../user-import/workContext';
import { randomUUID } from 'node:crypto';
import { placeHypothesisKey } from './domain/hypothesisKey';
import type {
  ContentSourcePlaceRecord,
  InsertPlaceLeadRow,
  InsertPlaceRow,
  InsertUnresolvedHypothesisRow,
  PlaceRecord,
  PlaceSaveSource,
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
  async setMembership(userId: string, saveId: string, restore: boolean): Promise<UserPlaceSaveRecord> {
    const row = this.saves.get(this.redirects.get(saveId) ?? saveId);
    if (!row || row.userId !== userId) throw new PlaceRepositoryError('Place save not found', 'not_found');
    if (restore && this.hypotheses.get(row.contentSourcePlaceId)?.retiredAt) throw new PlaceRepositoryError('Place result retired', 'invalid');
    const next = { ...row, removedAt: restore ? null : now(), explicitActionAt: now() };
    this.saves.set(row.id, next); return { ...next };
  }

  places = new Map<string, PlaceRecord>();
  hypotheses = new Map<string, ContentSourcePlaceRecord>();
  saves = new Map<string, UserPlaceSaveRecord>();
  sources = new Map<string, PlaceSaveSource>();
  private redirects = new Map<string, string>();
  sourceMedia = new Map<string, PlaceSourceMedia>();

  async loadStash(userId: string) {
    const saves = await this.listSavesByUser(userId);
    const sources = await this.listSourcesByUser(userId);
    const hypothesisIds = new Set([...saves.map(s => s.contentSourcePlaceId), ...sources.map(s => s.contentSourcePlaceId)]);
    const placeIds = new Set(saves.flatMap(s => s.placeId ? [s.placeId] : []));
    const sourceIds = new Set([...saves.map(s => s.contentSourceId), ...sources.map(s => s.contentSourceId)]);
    return { saves, sources,
      hypotheses: [...this.hypotheses.values()].filter(h => hypothesisIds.has(h.id)),
      places: [...this.places.values()].filter(p => placeIds.has(p.id)),
      media: new Map(await Promise.all([...sourceIds].map(async id => [id, await this.findSourceMedia(id)] as const))),
    };
  }

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
    assertImportWorkActive();
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
      .filter((row) => row.contentSourceId === contentSourceId && !row.retiredAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((row) => this.copyHypothesis(row));
  }

  async upsertHypothesis(row: InsertUnresolvedHypothesisRow): Promise<ContentSourcePlaceRecord> {
    const key = this.keyFor(row);
    const existing = await this.findHypothesis(row.contentSourceId, key);
    if (!existing) return this.writeHypothesis(row, key, null);
    const ts = now();
    const next: ContentSourcePlaceRecord = {
      ...existing, retiredAt: null,
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
    assertImportWorkActive();
    this.hypotheses.set(existing.id, next);
    return this.copyHypothesis(next);
  }

  async resolveHypothesis(row: InsertUnresolvedHypothesisRow, place: InsertPlaceRow): Promise<ContentSourcePlaceRecord> {
    assertImportWorkActive();
    // In-memory fixture repository; real atomicity is verified against PostgreSQL RPCs.
    const hypothesis = await this.upsertHypothesis(row);
    const existing = await this.findPlaceByProviderId(place.provider, place.providerPlaceId);
    const canonical = existing ?? await this.insertPlace(place);
    return this.markHypothesisResolved(hypothesis.id, canonical.id);
  }

  async markHypothesisResolved(id: string, placeId: string): Promise<ContentSourcePlaceRecord> {
    assertImportWorkActive();
    const existing = this.hypotheses.get(id);
    if (!existing) throw new PlaceRepositoryError('place hypothesis not found', 'not_found');
    if (!this.places.has(placeId)) throw new PlaceRepositoryError('canonical place not found', 'invalid');
    if (existing.placeId && existing.placeId !== placeId) {
      throw new PlaceRepositoryError('hypothesis already resolved to a different place', 'invalid');
    }
    const next: ContentSourcePlaceRecord = { ...existing, resolutionState: 'resolved', unresolvedReason: null,
      placeId, updatedAt: now() };
    assertImportWorkActive();
    this.hypotheses.set(id, next);
    for (const save of [...this.saves.values()].filter((row) => row.contentSourcePlaceId === id)) {
      const survivor = [...this.saves.values()].find((row) => row.userId === save.userId && row.placeId === placeId && row.id !== save.id);
      if (survivor) {
        if (save.explicitActionAt && (!survivor.explicitActionAt || save.explicitActionAt > survivor.explicitActionAt || (save.explicitActionAt === survivor.explicitActionAt && Boolean(save.removedAt)))) {
          this.saves.set(survivor.id, { ...survivor, removedAt: save.removedAt, explicitActionAt: save.explicitActionAt });
        }
        for (const [key, source] of this.sources) if (source.saveId === save.id) this.sources.set(key, { ...source, saveId: survivor.id });
        for (const [key, target] of this.redirects) if (target === save.id) this.redirects.set(key, survivor.id);
        this.redirects.set(save.id, survivor.id);
        this.saves.delete(save.id);
      } else this.saves.set(save.id, { ...save, placeId, updatedAt: now() });
    }
    return this.copyHypothesis(next);
  }

  async insertLead(row: InsertPlaceLeadRow): Promise<UserPlaceSaveRecord> {
    assertImportWorkActive();
    const hypothesis = this.hypotheses.get(row.contentSourcePlaceId);
    if (!hypothesis || hypothesis.contentSourceId !== row.contentSourceId) {
      throw new PlaceRepositoryError('content source does not match hypothesis', 'invalid');
    }
    let record = [...this.saves.values()].find((save) => save.userId === row.userId &&
      (hypothesis.placeId ? save.placeId === hypothesis.placeId : save.contentSourcePlaceId === hypothesis.id));
    if (!record) {
      const ts = now();
      record = { id: randomUUID(), userId: row.userId, contentSourcePlaceId: hypothesis.id,
        placeId: hypothesis.placeId, contentSourceId: row.contentSourceId, userImportId: row.userImportId,
        createdAt: ts, updatedAt: ts, schemaVersion: 1 };
      assertImportWorkActive();
      this.saves.set(record.id, record);
    }
    const key = `${row.userId}|${hypothesis.id}|${row.userImportId}`;
    this.sources.set(key, { saveId: record.id, userId: row.userId, contentSourcePlaceId: hypothesis.id,
      contentSourceId: row.contentSourceId, userImportId: row.userImportId,
      createdAt: this.sources.get(key)?.createdAt ?? now() });
    return { ...record };
  }

  async listSourcesByUser(userId: string): Promise<PlaceSaveSource[]> {
    return [...this.sources.values()].filter((s) => s.userId === userId).map((s) => ({ ...s }));
  }

  async findSaveByUserAndHypothesis(
    userId: string,
    contentSourcePlaceId: string,
  ): Promise<UserPlaceSaveRecord | null> {
    const source = [...this.sources.values()].find((s) => s.userId === userId && s.contentSourcePlaceId === contentSourcePlaceId);
    const save = source ? this.saves.get(source.saveId) : undefined;
    return save ? { ...save } : null;
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
      .filter((row) => row.userId === userId && !row.removedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({ ...row }));
  }

  async countByUserImport(userImportId: string): Promise<number> {
    return new Set([...this.sources.values()].filter((s) => s.userImportId === userImportId).map((s) => s.saveId)).size;
  }

  async upgradeLead(saveId: string, placeId: string): Promise<UpgradePlaceLeadResult> {
    assertImportWorkActive();
    const save = this.saves.get(saveId) ?? this.saves.get(this.redirects.get(saveId) ?? '');
    if (!save) throw new PlaceRepositoryError('place save not found', 'not_found');
    await this.markHypothesisResolved(save.contentSourcePlaceId, placeId);
    const after = await this.findSaveByUserAndPlace(save.userId, placeId);
    if (!after) throw new PlaceRepositoryError('place save not found', 'not_found');
    return { save: after, merged: after.id !== saveId };
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
      this.hypotheses.set(row.id, { ...row, retiredAt: now() });
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
    assertImportWorkActive();
    this.hypotheses.set(record.id, record);
    return this.copyHypothesis(record);
  }

  private copyHypothesis(row: ContentSourcePlaceRecord): ContentSourcePlaceRecord {
    return { ...row, evidence: { ...row.evidence }, sources: [...row.sources] };
  }
}
