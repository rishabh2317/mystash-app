import { placePresentationGroups } from './placePresentationGroups';
import type { PlaceUnresolvedReason } from './domain/types';
import {
  placeLocationLabel,
  resolveLeadSearchDestination,
  resolvePlaceDestination,
  type PlaceSearchDestination,
} from './placeDestination';
import {
  pickPlaceListImage,
  type PlaceListImage,
} from './placeListImage';
import type { PlaceRepository } from './PlaceRepository';

export type PlaceUncertainty = 'insufficient_detail' | 'ambiguous' | 'unconfirmed';

type PlaceListAttribution = {
  sourceVideo?: { url: string; thumbnailUrl: string | null } | null;
  sourceVideos?: { url: string; thumbnailUrl: string | null }[];
  presentationGroupId?: string;
  extractedCategory?: string | null;
  categorySource?: 'resolved' | 'extracted';
  saveId: string;
  resolutionStatus: 'resolved' | 'unverified';
  sources: { contentSourceId: string; userImportId: string; contentSourcePlaceId: string; addedAt: string;
    sourceVideo?: { url: string; thumbnailUrl: string | null } | null }[];
};
export type PlaceListItem = PlaceListAttribution & (
  | {
      kind: 'resolved';
      name: string;
      category: string | null;
      addedAt: string;
      source: { contentSourceId: string; userImportId: string };
      placeId: string;
      localityLabel: string | null;
      destination: PlaceSearchDestination;
      formattedAddress: string | null;
      latitude: number | null;
      longitude: number | null;
      image: PlaceListImage | null;
    }
  | {
      kind: 'unresolved';
      name: string;
      category: string | null;
      addedAt: string;
      source: { contentSourceId: string; userImportId: string };
      leadId: string;
      locationContext: string | null;
      uncertainty: PlaceUncertainty;
      destination: PlaceSearchDestination;
      image: PlaceListImage | null;
    });

export type PlaceListView = {
  items: PlaceListItem[];
  itemCount: number;
  displayItemCount?: number;
  nextCursor?: string | null;
};

export type PlacePageOptions = { limit: number; cursor?: string };
export class PlacePageError extends Error {}

export function uncertaintyForReason(reason: PlaceUnresolvedReason | null): PlaceUncertainty {
  if (reason === 'name_not_distinctive') return 'insufficient_detail';
  if (reason === 'ambiguous') return 'ambiguous';
  return 'unconfirmed';
}

export class PlaceService {
  constructor(private readonly repository: PlaceRepository) {}

  async listForUser(userId: string, page?: PlacePageOptions): Promise<PlaceListView> {
    const snapshot = await this.repository.loadStash(userId);
    const { saves, media: mediaBySource } = snapshot;
    const hypotheses = new Map(snapshot.hypotheses.map(h => [h.id, h]));
    const places = new Map(snapshot.places.map(p => [p.id, p]));
    const groups = placePresentationGroups(saves, snapshot.hypotheses);
    const sourceVideoFor = (id: string) => {
      const media = mediaBySource.get(id);
      return media?.sourceUrl ? { url: media.sourceUrl, thumbnailUrl: media.sourceThumbnailUrl ?? media.frameUrl } : null;
    };
    const items: PlaceListItem[] = [];
    const sourceRows = snapshot.sources;
    const sourcesBySave = new Map<string, PlaceListItem['sources']>();
    for (const row of sourceRows) {
      const list = sourcesBySave.get(row.saveId) ?? [];
      list.push({ contentSourceId: row.contentSourceId, userImportId: row.userImportId,
        contentSourcePlaceId: row.contentSourcePlaceId, addedAt: row.createdAt, sourceVideo: sourceVideoFor(row.contentSourceId) });
      sourcesBySave.set(row.saveId, list);
    }
    for (const save of saves) {
      const hypothesis = hypotheses.get(save.contentSourcePlaceId);
      if (!hypothesis || hypothesis.retiredAt) continue;
      const source = {
        contentSourceId: save.contentSourceId,
        userImportId: save.userImportId,
      };
      const sources = sourcesBySave.get(save.id) ?? [];
      const sourceVideos = [...new Map([sourceVideoFor(save.contentSourceId), ...sources.map(s => s.sourceVideo)]
        .filter((video): video is { url: string; thumbnailUrl: string | null } => Boolean(video))
        .map(video => [video.url, video])).values()];
      // Prefer the primary source, then any existing authorized associated image.
      const sourceIds = [save.contentSourceId, ...sources.map(s => s.contentSourceId)];
      const image = sourceIds.map(id => {
        const media = mediaBySource.get(id);
        return pickPlaceListImage({ allowProvider: Boolean(save.placeId),
          sourceThumbnailUrl: media?.sourceThumbnailUrl, frameUrl: media?.frameUrl });
      }).find(Boolean) ?? null;
      const sourceVideo = sourceVideos[0] ?? null;
      const attribution = { sourceVideo, sourceVideos, saveId: save.id, sources, extractedCategory: hypothesis.category,
        ...(groups.has(save.id) ? { presentationGroupId: groups.get(save.id) } : {}) };
      if (save.placeId) {
        const place = places.get(save.placeId);
        if (!place) continue;
        items.push({
          kind: 'resolved', ...attribution, resolutionStatus: 'resolved',
          name: place.name,
          category: place.category ?? hypothesis.category,
          categorySource: place.category ? 'resolved' : hypothesis.category ? 'extracted' : undefined,
          addedAt: save.createdAt,
          source,
          placeId: place.id,
          localityLabel: placeLocationLabel(place),
          destination: resolvePlaceDestination({
            name: place.name,
            locality: place.locality,
            city: place.city,
            region: place.region,
            country: place.country,
          }),
          formattedAddress: place.formattedAddress,
          latitude: place.latitude,
          longitude: place.longitude,
          image,
        });
        continue;
      }
      items.push({
        kind: 'unresolved', ...attribution, resolutionStatus: 'unverified',
        name: hypothesis.extractedName,
        category: hypothesis.category,
        categorySource: hypothesis.category ? 'extracted' : undefined,
        addedAt: save.createdAt,
        source,
        leadId: save.id,
        locationContext: placeLocationLabel({
          locality: hypothesis.locality,
          city: hypothesis.city,
          region: hypothesis.region,
          country: hypothesis.country,
          mentionedAddress: hypothesis.mentionedAddress,
        }),
        uncertainty: uncertaintyForReason(hypothesis.unresolvedReason),
        destination: resolveLeadSearchDestination({
          name: hypothesis.extractedName,
          locality: hypothesis.locality,
          city: hypothesis.city,
          region: hypothesis.region,
          country: hypothesis.country,
          mentionedAddress: hypothesis.mentionedAddress,
        }),
        image,
      });
    }
    // Legacy requests keep all records and their original identities. Opt-in
    // pagination slices display groups together, so refinements never split pages.
    const grouped = new Map<string, PlaceListItem[]>();
    for (const item of items) {
      const key = item.kind === 'resolved' ? `place:${item.placeId}` : `lead:${item.presentationGroupId ?? item.saveId}`;
      const rows = grouped.get(key) ?? []; rows.push(item); grouped.set(key, rows);
    }
    const cards = [...grouped.entries()];
    if (!page) return { items, itemCount: items.length, displayItemCount: cards.length };
    if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100) throw new PlacePageError('Invalid Places page size');
    let offset = 0;
    if (page.cursor) {
      let key: unknown;
      try { key = JSON.parse(Buffer.from(page.cursor, 'base64url').toString('utf8')); }
      catch { throw new PlacePageError('Invalid Places cursor'); }
      const index = cards.findIndex(([id]) => id === key);
      if (index < 0) throw new PlacePageError('Places changed; refresh the list');
      offset = index + 1;
    }
    const slice = cards.slice(offset, offset + page.limit);
    const nextCursor = offset + slice.length < cards.length
      ? Buffer.from(JSON.stringify(slice[slice.length - 1][0])).toString('base64url') : null;
    return { items: slice.flatMap(([, rows]) => rows), itemCount: items.length, displayItemCount: cards.length, nextCursor };
  }
}
