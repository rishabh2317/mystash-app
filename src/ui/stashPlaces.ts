import { normalizedPlaceCategory, type PlaceCategoryKey } from './placeCategories';
import type {
  PlaceStashAttribution,
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
  loadErrorHint: 'Try again to see the places you’ve saved.',
  refreshError: 'Couldn’t refresh places',
  refreshErrorHint: 'Your saved places are still here. Try again in a moment.',
  title: 'Your places',
  subtitle: 'From videos you’ve saved.',
  unverified: 'Unverified',
  locationUnclear: 'Location unclear',
  needsLocation: 'Needs location',
  noPhoto: 'No photo available',
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
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
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

function attribution(row: Record<string, unknown>): PlaceStashAttribution {
  const saveId = asString(row.saveId);
  const addedAt = asString(row.addedAt);
  const presentationGroupId = row.kind === 'unresolved' ? asString(row.presentationGroupId) : null;
  const rawSource = row.source && typeof row.source === 'object' ? row.source as Record<string, unknown> : null;
  const contentSourceId = asString(rawSource?.contentSourceId), userImportId = asString(rawSource?.userImportId);
  const source = contentSourceId && userImportId ? { source: { contentSourceId, userImportId } } : {};
  const resolutionStatus = row.kind === 'resolved' ? 'resolved' as const : 'unverified' as const;
  const sources = Array.isArray(row.sources) ? row.sources.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const s = value as Record<string, unknown>;
    const contentSourceId = asString(s.contentSourceId), userImportId = asString(s.userImportId);
    const contentSourcePlaceId = asString(s.contentSourcePlaceId), addedAt = asString(s.addedAt);
    return contentSourceId && userImportId && contentSourcePlaceId && addedAt
      ? [{ contentSourceId, userImportId, contentSourcePlaceId, addedAt, ...sourceVideo(s) }] : [];
  }) : [];
  const sourceVideos = Array.isArray(row.sourceVideos) ? row.sourceVideos.flatMap(value => {
    const parsed = sourceVideo({ sourceVideo: value }).sourceVideo;
    return parsed ? [parsed] : [];
  }) : undefined;
  return { ...source, ...(saveId ? { saveId } : {}), ...(saveId || Array.isArray(row.sources) ? { sources } : {}), resolutionStatus,
    ...(addedAt && Number.isFinite(Date.parse(addedAt)) ? { addedAt } : {}),
    ...(presentationGroupId ? { presentationGroupId } : {}),
    ...('extractedCategory' in row ? { extractedCategory: asString(row.extractedCategory) } : {}),
    ...(row.categorySource === 'resolved' || row.categorySource === 'extracted' ? { categorySource: row.categorySource } : {}),
    ...(sourceVideos ? { sourceVideos } : {}),
  };
}

function sourceVideo(row: Record<string, unknown>) {
  if (!('sourceVideo' in row) || row.sourceVideo === undefined) return {};
  const raw = row.sourceVideo;
  if (!raw || typeof raw !== 'object') return { sourceVideo: null };
  const value = raw as Record<string, unknown>;
  const url = asString(value.url);
  return { sourceVideo: url ? { url, thumbnailUrl: httpUrl(value.thumbnailUrl) } : null };
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
      kind: 'resolved', ...attribution(row), ...sourceVideo(row),
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
      kind: 'unresolved', ...attribution(row), ...sourceVideo(row),
      category: asString(row.category),
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
  return { items, itemCount,
    ...(typeof row.displayItemCount === 'number' && Number.isFinite(row.displayItemCount)
      ? { displayItemCount: Math.max(0, Math.floor(row.displayItemCount)) } : {}),
    ...('nextCursor' in row ? { nextCursor: asString(row.nextCursor) } : {}),
  };
}

export function placeStashItemKey(item: PlaceStashItem): string {
  if (item.kind === 'unresolved' && item.presentationGroupId) return `lead-group:${item.presentationGroupId}`;
  if (item.saveId) return `save:${item.saveId}`;
  return `${item.kind}:${item.id}`;
}

/** One presentation dataset, retaining API order and the actual backend identities.
 * Only canonical IDs, save IDs, explicit hypothesis links, or backend-proven
 * presentation groups prove equivalence.
 * Names and locations are never identity keys. */
export function unifiedPlaceStashItems(items: readonly PlaceStashItem[]): PlaceStashItem[] {
  const resolved = new Map<string, PlaceStashItem>();
  const merge = (winner: PlaceStashItem, other: PlaceStashItem): PlaceStashItem => {
    const sources = [...(winner.sources ?? []), ...(other.sources ?? [])];
    const videos = [...(winner.sourceVideos ?? []), ...(other.sourceVideos ?? []),
      ...(winner.sourceVideo ? [winner.sourceVideo] : []), ...(other.sourceVideo ? [other.sourceVideo] : [])];
    const groupedSaveIds = [...new Set([...(winner.groupedSaveIds ?? []), ...(other.groupedSaveIds ?? []),
      ...(winner.saveId ? [winner.saveId] : []), ...(other.saveId ? [other.saveId] : [])])];
    return { ...winner,
      ...(videos.length ? { sourceVideos: [...new Map(videos.map(video => [video.url, video])).values()] } : {}),
      ...(groupedSaveIds.length > 1 ? { groupedSaveIds } : {}),
      ...(winner.addedAt && other.addedAt ? { addedAt: winner.addedAt > other.addedAt ? winner.addedAt : other.addedAt } : {}),
      image: winner.image ?? other.image,
      ...(winner.sourceVideo == null && other.sourceVideo !== undefined ? { sourceVideo: other.sourceVideo } : {}),
      ...(sources.length ? { sources: [...new Map(sources.map((s) =>
        [`${s.contentSourceId}:${s.contentSourcePlaceId}:${s.userImportId}`, s])).values()] } : {}) };
  };
  for (const item of items) if (item.kind === 'resolved') {
    const prior = resolved.get(item.id);
    resolved.set(item.id, prior ? merge(prior, item) : item);
  }
  const bySave = new Map<string, Set<string>>(), byHypothesis = new Map<string, Set<string>>();
  const index = (map: Map<string, Set<string>>, key: string, id: string) => {
    const ids = map.get(key) ?? new Set<string>();
    ids.add(id); map.set(key, ids);
  };
  for (const place of items) if (place.kind === 'resolved') {
    if (place.saveId) index(bySave, place.saveId, place.id);
    for (const source of place.sources ?? []) index(byHypothesis, source.contentSourcePlaceId, place.id);
  }
  const winners = new Map<string, PlaceStashItem>();
  for (const item of items) {
    let candidate = item.kind === 'resolved' ? resolved.get(item.id)! : item;
    if (item.kind === 'unresolved') {
      const matches = new Set(bySave.get(item.saveId ?? item.id));
      for (const source of item.sources ?? []) {
        for (const id of byHypothesis.get(source.contentSourcePlaceId) ?? []) matches.add(id);
      }
      // Conflicting canonical identities remain separate for the backend to resolve.
      if (matches.size === 1) {
        candidate = merge(resolved.get([...matches][0])!, item);
        resolved.set(candidate.id, candidate);
      }
    }
    const key = candidate.kind === 'unresolved' && candidate.presentationGroupId
      ? `lead-group:${candidate.presentationGroupId}` : `${candidate.kind}:${candidate.id}`;
    const prior = winners.get(key);
    // Group membership is proven by the backend. Prefer its richer extracted
    // location without replacing the underlying save/entity IDs used by Analytics.
    const preferCandidate = prior?.kind === 'unresolved' && candidate.kind === 'unresolved'
      && candidate.presentationGroupId && (candidate.locationContext?.length ?? 0) > (prior.locationContext?.length ?? 0);
    winners.set(key, prior ? preferCandidate ? merge(candidate, prior) : merge(prior, candidate) : candidate);
  }
  return [...winners.values()];
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
  categoryText: string | null;
  location: string | null;
  uncertainty: string | null;
  ctaLabel: string;
  searchUrl: string;
  imageUrl: string | null;
  imageLabel: string | null;
  sourceLabel: string | null;
  statusLabel: string | null;
  lead: boolean;
};

/** Display fields only. Unresolved leads never get address/rating/provider chrome. */
export function placeCardView(item: PlaceStashItem): PlaceCardView {
  const sourceCount = new Set(item.sources?.map((s) => s.contentSourceId) ?? []).size;
  const fromVideo = item.image?.kind === 'source' || item.image?.kind === 'frame';
  return {
    name: item.name,
    category: item.category ?? null,
    categoryText: placeCategoryText(item),
    location: item.kind === 'resolved' ? item.localityLabel ?? item.formattedAddress : item.locationContext,
    uncertainty: item.kind === 'unresolved' ? PLACE_UNCERTAINTY_COPY[item.uncertainty] : null,
    ctaLabel: STASH_PLACES_COPY.searchOnGoogle,
    searchUrl: placeSearchUrl(item),
    imageUrl: item.image?.url ?? null,
    imageLabel: item.image?.kind === 'source' ? 'Saved video preview'
      : item.image?.kind === 'frame' ? 'Saved video frame' : item.image ? 'Place photo' : null,
    sourceLabel: sourceCount > 1 ? `From ${sourceCount} saved videos`
      : sourceCount === 1 || fromVideo ? 'From your saved video' : null,
    statusLabel: item.kind === 'unresolved' ? STASH_PLACES_COPY.unverified : null,
    lead: item.kind === 'unresolved',
  };
}


export type PlaceCategoryShelf = {
  key: PlaceCategoryKey; title: string; count: number; previewUrls: string[]; items: PlaceStashItem[];
};
export function buildPlacesHome(raw: readonly PlaceStashItem[]) {
  const items = unifiedPlaceStashItems(raw);
  // Legacy responses retain API order. Only sort when both timestamps are known.
  const indexed = items.map((item, index) => ({ item, index }));
  if (indexed.every(row => row.item.addedAt)) indexed.sort((a, b) =>
    Date.parse(b.item.addedAt!) - Date.parse(a.item.addedAt!) || a.index - b.index);
  const sorted = indexed.map(row => row.item);
  const categories = new Map<PlaceCategoryKey, PlaceCategoryShelf>();
  for (const item of sorted) {
    const category = normalizedPlaceCategory(item.category);
    const shelf = categories.get(category.key) ?? { ...category, count: 0, previewUrls: [], items: [] };
    shelf.items.push(item); shelf.count++;
    if (item.image?.url && shelf.previewUrls.length < 4 && !shelf.previewUrls.includes(item.image.url)) shelf.previewUrls.push(item.image.url);
    categories.set(category.key, shelf);
  }
  return { categories: [...categories.values()], recent: sorted.slice(0, 8), items: sorted, count: sorted.length };
}

/** Product shelf density, with an accessible single-column layout at large text. */
export function placesColumnCount(width: number, fontScale = 1): 1 | 2 {
  return width < 320 || fontScale >= 1.6 ? 1 : 2;
}


/** Only types actually supplied by extraction/resolution. Never expand Brewery
 * into Restaurant/Bar, or infer landmark types from the place's name. */
export function placeCategoryText(item: Pick<PlaceStashItem, 'category' | 'extractedCategory'>): string | null {
  const labels = new Map<string, string>();
  for (const raw of [item.category, item.extractedCategory]) {
    if (!raw) continue;
    for (const value of raw.replace(/\bN\/A\b/gi, '').split(/[·;,|/]/)) {
      const label = value.replace(/_/g, ' ').trim().replace(/\s+/g, ' ');
      if (!label || /^(unknown|other|na|unclassified)$/i.test(label)) continue;
      const key = label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      if (!labels.has(key)) labels.set(key, label.charAt(0).toUpperCase() + label.slice(1).toLowerCase());
    }
  }
  return labels.size ? [...labels.values()].join(' · ') : null;
}
