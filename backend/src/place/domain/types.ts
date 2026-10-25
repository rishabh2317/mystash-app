/**
 * Place Resolution V1 records.
 * `places` is canonical identity only. An unresolved lead keeps placeId null.
 */

export type PlaceResolutionState = 'resolved' | 'unresolved';

export type PlaceUnresolvedReason =
  | 'name_not_distinctive'
  | 'ambiguous'
  | 'no_results'
  | 'provider_failed'
  | 'locality_conflict'
  | 'category_conflict'
  | 'pending_resolution';

export type PlaceRecord = {
  id: string;
  provider: string;
  providerPlaceId: string;
  name: string;
  locality: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  category: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
};

export type InsertPlaceRow = {
  provider: string;
  providerPlaceId: string;
  name: string;
  locality?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  category?: string | null;
  formattedAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  mapsUrl?: string | null;
};

export type ContentSourcePlaceRecord = {
  id: string;
  contentSourceId: string;
  extractedName: string;
  category: string | null;
  locality: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  mentionedAddress: string | null;
  confidence: number | null;
  evidence: Record<string, unknown>;
  sources: string[];
  resolutionState: PlaceResolutionState;
  unresolvedReason: PlaceUnresolvedReason | null;
  placeId: string | null;
  hypothesisKey: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
};

export type InsertUnresolvedHypothesisRow = {
  contentSourceId: string;
  extractedName: string;
  unresolvedReason: PlaceUnresolvedReason;
  category?: string | null;
  locality?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  mentionedAddress?: string | null;
  confidence?: number | null;
  evidence?: Record<string, unknown>;
  sources?: string[];
};

export type UserPlaceSaveRecord = {
  id: string;
  userId: string;
  contentSourcePlaceId: string;
  placeId: string | null;
  contentSourceId: string;
  userImportId: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
};

export type InsertPlaceLeadRow = {
  userId: string;
  contentSourcePlaceId: string;
  contentSourceId: string;
  userImportId: string;
};

export type UpgradePlaceLeadResult = {
  save: UserPlaceSaveRecord;
  /** True when this lead was removed because the user already had that canonical place. */
  merged: boolean;
};
