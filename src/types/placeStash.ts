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

export type PlaceStashResolved = {
  kind: 'resolved';
  id: string;
  name: string;
  category: string | null;
  localityLabel: string | null;
  formattedAddress: string | null;
  destination: PlaceStashDestination;
  image: PlaceStashImage | null;
};

export type PlaceStashUnresolved = {
  kind: 'unresolved';
  id: string;
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
};
