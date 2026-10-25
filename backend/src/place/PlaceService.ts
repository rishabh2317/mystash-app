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

export type PlaceListItem =
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
    };

export type PlaceListView = {
  items: PlaceListItem[];
  itemCount: number;
};

export function uncertaintyForReason(reason: PlaceUnresolvedReason | null): PlaceUncertainty {
  if (reason === 'name_not_distinctive') return 'insufficient_detail';
  if (reason === 'ambiguous') return 'ambiguous';
  return 'unconfirmed';
}

export class PlaceService {
  constructor(private readonly repository: PlaceRepository) {}

  async listForUser(userId: string): Promise<PlaceListView> {
    const saves = await this.repository.listSavesByUser(userId);
    const items: PlaceListItem[] = [];
    const mediaBySource = new Map<string, Awaited<ReturnType<PlaceRepository['findSourceMedia']>>>();
    for (const save of saves) {
      const hypothesis = await this.repository.findHypothesisById(save.contentSourcePlaceId);
      if (!hypothesis) continue;
      const source = {
        contentSourceId: save.contentSourceId,
        userImportId: save.userImportId,
      };
      let media = mediaBySource.get(save.contentSourceId);
      if (!media) {
        media = await this.repository.findSourceMedia(save.contentSourceId);
        mediaBySource.set(save.contentSourceId, media);
      }
      const image = pickPlaceListImage({
        allowProvider: Boolean(save.placeId),
        sourceThumbnailUrl: media.sourceThumbnailUrl,
        frameUrl: media.frameUrl,
      });
      if (save.placeId) {
        const place = await this.repository.findPlaceById(save.placeId);
        if (!place) continue;
        items.push({
          kind: 'resolved',
          name: place.name,
          category: place.category,
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
        kind: 'unresolved',
        name: hypothesis.extractedName,
        category: hypothesis.category,
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
    return { items, itemCount: items.length };
  }
}
