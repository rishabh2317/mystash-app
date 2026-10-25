export type PlaceListImageKind = 'provider' | 'source' | 'frame';

export type PlaceListImage = {
  url: string;
  kind: PlaceListImageKind;
};

export type PlaceSourceMedia = {
  sourceThumbnailUrl: string | null;
  frameUrl: string | null;
};

function httpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.startsWith('http') ? trimmed : null;
}

/**
 * Stash media order. Provider photos are never invented.
 * Unresolved leads skip provider images even if a caller passes one.
 */
export function pickPlaceListImage(input: {
  allowProvider: boolean;
  providerImageUrl?: string | null;
  sourceThumbnailUrl?: string | null;
  frameUrl?: string | null;
}): PlaceListImage | null {
  const provider = input.allowProvider ? httpUrl(input.providerImageUrl) : null;
  if (provider) return { url: provider, kind: 'provider' };
  const source = httpUrl(input.sourceThumbnailUrl);
  if (source) return { url: source, kind: 'source' };
  const frame = httpUrl(input.frameUrl);
  if (frame) return { url: frame, kind: 'frame' };
  return null;
}
