export type PlaceSourceVideo = { url: string; thumbnailUrl: string | null };

export type PlaceStashAttribution = {
  source?: { contentSourceId: string; userImportId: string };
  sourceVideo?: PlaceSourceVideo | null;
  sourceVideos?: PlaceSourceVideo[];
  addedAt?: string;
  extractedCategory?: string | null;
  categorySource?: 'resolved' | 'extracted';
  presentationGroupId?: string;
  groupedSaveIds?: string[];
  saveId?: string;
  resolutionStatus?: 'resolved' | 'unverified';
  sources?: { contentSourceId: string; userImportId: string; contentSourcePlaceId: string; addedAt: string; sourceVideo?: PlaceSourceVideo | null }[];
};

export type PlaceStashUncertainty = 'insufficient_detail' | 'ambiguous' | 'unconfirmed';

export type PlaceStashDestination = {
  kind: 'google_search';
  query: string;
  url: string;
};

export type PlaceStashImageKind = 'provider' | 'source' | 'frame';

export type PlaceStashImage = {
  url: string;
  kind: PlaceStashImageKind;
};

export type PlaceStashResolved = PlaceStashAttribution & {
  kind: 'resolved';
  id: string;
  name: string;
  category: string | null;
  localityLabel: string | null;
  formattedAddress: string | null;
  destination: PlaceStashDestination;
  image: PlaceStashImage | null;
};

export type PlaceStashUnresolved = PlaceStashAttribution & {
  kind: 'unresolved';
  id: string;
  category?: string | null;
  name: string;
  locationContext: string | null;
  uncertainty: PlaceStashUncertainty;
  destination: PlaceStashDestination;
  image: PlaceStashImage | null;
};

export type PlaceStashItem = PlaceStashResolved | PlaceStashUnresolved;

export type PlaceStashPage = {
  items: PlaceStashItem[];
  itemCount: number;
  displayItemCount?: number;
  nextCursor?: string | null;
};
