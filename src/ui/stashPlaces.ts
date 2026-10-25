import type {
  PlaceStashDestination,
  PlaceStashImage,
  PlaceStashImageKind,
  PlaceStashItem,
  PlaceStashPage,
  PlaceStashUncertainty,
} from '@/src/types/placeStash';

export const STASH_SEGMENT = {
  products: 'products',
  places: 'places',
} as const;

export type StashSegment = (typeof STASH_SEGMENT)[keyof typeof STASH_SEGMENT];

export const DEFAULT_STASH_SEGMENT: StashSegment = STASH_SEGMENT.products;

export function stashContentTab(
  tab: StashSegment,
  opts?: { selectedCategory?: boolean },
): StashSegment {
  if (opts?.selectedCategory) return STASH_SEGMENT.products;
  return tab;
}

export const STASH_SEGMENT_TABS = [
  { id: STASH_SEGMENT.products, label: 'Products' },
  { id: STASH_SEGMENT.places, label: 'Places' },
] as const;

export const STASH_PLACES_COPY = {
  searchOnGoogle: 'Search on Google',
  empty: 'No places yet',
  emptyHint: 'Places from your saved videos will show up here.',
  loadError: 'Couldn’t load places',
  retry: 'Retry',
  openError: 'Couldn’t open Google Search.',
  placesSection: 'Places',
  leadsSection: 'Leads',
} as const;

export const PLACE_UNCERTAINTY_COPY: Record<PlaceStashUncertainty, string> = {
  insufficient_detail: 'Not enough detail to confirm this place',
  ambiguous: 'More than one place could match',
  unconfirmed: 'Not confirmed yet',
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asDestination(value: unknown): PlaceStashDestination | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== 'google_search') return null;
  const query = asString(row.query);
  const url = asString(row.url);
  if (!query || !url || !url.startsWith('http')) return null;
  return { kind: 'google_search', query, url };
}

function asUncertainty(value: unknown): PlaceStashUncertainty {
  if (value === 'insufficient_detail' || value === 'ambiguous' || value === 'unconfirmed') {
    return value;
  }
  return 'unconfirmed';
}

function asImageKind(value: unknown): PlaceStashImageKind | null {
  if (value === 'provider' || value === 'source' || value === 'frame') return value;
  return null;
}

function httpUrl(value: unknown): string | null {
  const url = asString(value);
  return url && url.startsWith('http') ? url : null;
}

/** Provider → source thumbnail → reel/video frame. Never invents a URL. */
export function pickPlaceStashImage(input: {
  itemKind: 'resolved' | 'unresolved';
  image?: unknown;
  providerUrl?: unknown;
  sourceUrl?: unknown;
  frameUrl?: unknown;
}): PlaceStashImage | null {
  const allowProvider = input.itemKind === 'resolved';
  const direct = input.image && typeof input.image === 'object' ? (input.image as Record<string, unknown>) : null;
  const directKind = direct ? asImageKind(direct.kind) : null;
  const directUrl = direct ? httpUrl(direct.url) : null;
  if (directKind && directUrl && (allowProvider || directKind !== 'provider')) {
    return { url: directUrl, kind: directKind };
  }

  const provider = allowProvider ? httpUrl(input.providerUrl) : null;
  if (provider) return { url: provider, kind: 'provider' };
  const source = httpUrl(input.sourceUrl);
  if (source) return { url: source, kind: 'source' };
  const frame = httpUrl(input.frameUrl);
  if (frame) return { url: frame, kind: 'frame' };
  return null;
}

export function hydratePlaceStashItem(raw: unknown): PlaceStashItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const name = asString(row.name);
  const destination = asDestination(row.destination);
  if (!name || !destination) return null;

  if (row.kind === 'resolved') {
    const id = asString(row.placeId);
    if (!id) return null;
    return {
      kind: 'resolved',
      id,
      name,
      category: asString(row.category),
      localityLabel: asString(row.localityLabel),
      formattedAddress: asString(row.formattedAddress),
      destination,
      image: pickPlaceStashImage({
        itemKind: 'resolved',
        image: row.image,
        providerUrl: row.providerImageUrl,
        sourceUrl: row.sourceThumbnailUrl,
        frameUrl: row.frameUrl,
      }),
    };
  }

  if (row.kind === 'unresolved') {
    const id = asString(row.leadId);
    if (!id) return null;
    return {
      kind: 'unresolved',
      id,
      name,
      locationContext: asString(row.locationContext),
      uncertainty: asUncertainty(row.uncertainty),
      destination,
      image: pickPlaceStashImage({
        itemKind: 'unresolved',
        image: row.image,
        providerUrl: row.providerImageUrl,
        sourceUrl: row.sourceThumbnailUrl,
        frameUrl: row.frameUrl,
      }),
    };
  }

  return null;
}

export function hydratePlaceStashPage(raw: unknown): PlaceStashPage {
  if (!raw || typeof raw !== 'object') return { items: [], itemCount: 0 };
  const row = raw as Record<string, unknown>;
  const items: PlaceStashItem[] = [];
  if (Array.isArray(row.items)) {
    for (const item of row.items) {
      const mapped = hydratePlaceStashItem(item);
      if (mapped) items.push(mapped);
    }
  }
  const itemCount =
    typeof row.itemCount === 'number' && Number.isFinite(row.itemCount)
      ? Math.max(items.length, Math.floor(row.itemCount))
      : items.length;
  return { items, itemCount };
}

export function placeStashItemKey(item: PlaceStashItem): string {
  return `${item.kind}:${item.id}`;
}

export function placeSearchUrl(item: Pick<PlaceStashItem, 'destination'>): string {
  return item.destination.url;
}

export function partitionPlaceStashItems(items: PlaceStashItem[]): {
  places: PlaceStashItem[];
  leads: PlaceStashItem[];
} {
  return {
    places: items.filter((item) => item.kind === 'resolved'),
    leads: items.filter((item) => item.kind === 'unresolved'),
  };
}

export type PlaceCardView = {
  name: string;
  category: string | null;
  location: string | null;
  uncertainty: string | null;
  ctaLabel: string;
  searchUrl: string;
  imageUrl: string | null;
  lead: boolean;
};

/** Display fields only. Unresolved leads never get address/rating/provider chrome. */
export function placeCardView(item: PlaceStashItem): PlaceCardView {
  return {
    name: item.name,
    category: item.kind === 'resolved' ? item.category : null,
    location: item.kind === 'resolved' ? item.localityLabel : item.locationContext,
    uncertainty: item.kind === 'unresolved' ? PLACE_UNCERTAINTY_COPY[item.uncertainty] : null,
    ctaLabel: STASH_PLACES_COPY.searchOnGoogle,
    searchUrl: placeSearchUrl(item),
    imageUrl: item.image?.url ?? null,
    lead: item.kind === 'unresolved',
  };
}
